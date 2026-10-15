import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { isSessionToken, getSessionState } from './middleware/auth.js';
import { APP_ORIGINS } from './config/appOrigins.js';

dotenv.config();

let io: Server;

export const initSocket = (server: HttpServer) => {
    io = new Server(server, {
        cors: {
            // SBP-005: Use strict origin allowlist instead of wildcard
            // Must match the Express CORS allowedOrigins list in index.ts
            origin: [...(process.env.ALLOWED_ORIGINS
                ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
                : [
                    'http://localhost:5173',
                    'http://localhost:3000',
                    'http://localhost:8080',
                    'http://localhost:8081',
                    'http://127.0.0.1:8080',
                    'https://warranty2.autoformindia.co.in'
                  ]), ...APP_ORIGINS],
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    // Authentication middleware for Socket.io
    io.use(async (socket, next) => {
        // SBP-006: Read token from cookie first, then fall back to handshake auth
        const cookieHeader = socket.handshake.headers.cookie || '';
        const cookies = Object.fromEntries(
            cookieHeader.split(';').map(c => {
                const [key, ...val] = c.trim().split('=');
                return [key, val.join('=')];
            })
        );
        const token = cookies['auth_token'] || socket.handshake.auth?.token;

        if (!token) {
            return next(new Error('Authentication error: Token missing'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as any;

            // Same rule as the HTTP middleware: a single-purpose action token
            // (invoice download, franchise verify link) is signed with the same
            // secret but is not a session, and must not join a user's room.
            if (!isSessionToken(decoded)) {
                return next(new Error('Authentication error: Invalid token'));
            }

            // A deactivated store or removed admin must not keep receiving
            // live notifications on a cookie that is still in date.
            const state = await getSessionState(decoded.id, decoded.role);
            if (!state.active) {
                return next(new Error('Authentication error: Account inactive'));
            }

            socket.data.user = decoded;
            next();
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.data.user?.id;
        const role = socket.data.user?.role;

        if (userId) {
            console.log(`📡 User ${userId} (${role}) connected to socket`);

            // Join universal user-specific room
            socket.join(`user_${userId}`);

            // Join role-specific rooms for efficient broadcasting
            if (role) {
                socket.join(`role_${role}`);
                console.log(`📡 User ${userId} joined room: role_${role}`);
            }
        }

        socket.on('disconnect', () => {
            console.log(`🔌 User ${userId} disconnected from socket`);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};
