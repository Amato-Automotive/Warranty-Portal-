
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api, { getErrorMessage } from '../lib/api';
import {
    CheckCircle2,
    Clock,
    AlertCircle,
    Calendar,
    MessageSquare,
    Loader2,
    ArrowRight
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../components/ui/select";
import { useToast } from '../components/ui/use-toast';

// Re-using Button from ui/button
import { Button } from '../components/ui/button';

import { getISTYear } from '../lib/utils';

export default function AssignmentUpdatePanel() {
    const { token } = useParams<{ token: string }>();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [assignment, setAssignment] = useState<any>(null);
    const [status, setStatus] = useState<string>('');
    const [remarks, setRemarks] = useState<string>('');

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                const response = await api.get(`/assignment/details/${token}`);
                if (response.data.success) {
                    setAssignment(response.data.data);
                    setStatus(response.data.data.status || 'pending');
                }
            } catch (error: any) {
                console.error('Failed to fetch assignment details:', error);
                toast({
                    title: "Error",
                    description: getErrorMessage(error, "Invalid or expired assignment link"),
                    variant: "destructive"
                });
            } finally {
                setLoading(false);
            }
        };

        if (token) {
            fetchDetails();
        }
    }, [token, toast]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!status) return;

        setSubmitting(true);
        try {
            const response = await api.post(`/assignment/update/${token}`, {
                status,
                remarks
            });

            if (response.data.success) {
                setSubmitted(true);
                toast({
                    title: "Success",
                    description: "Status updated successfully. Thank you!"
                });
            }
        } catch (error: any) {
            console.error('Update failed:', error);
            toast({
                title: "Update Failed",
                description: getErrorMessage(error, "Failed to update assignment status"),
                variant: "destructive"
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-4">
                <div className="text-center">
                    <Loader2 className="h-10 w-10 animate-spin text-orange-500 mx-auto mb-4" />
                    <p className="text-muted-foreground animate-pulse font-medium">Loading task details...</p>
                </div>
            </div>
        );
    }

    if (!assignment) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-4">
                <Card className="max-w-md w-full border-t-4 border-t-red-500 shadow-xl">
                    <CardHeader className="text-center">
                        <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4 opacity-75" />
                        <CardTitle className="text-2xl">Link Expired or Invalid</CardTitle>
                        <CardDescription className="text-base mt-2">
                            This assignment link is no longer valid or has expired. Please contact the administrator for a new link.
                        </CardDescription>
                    </CardHeader>
                    <CardFooter className="justify-center">
                        <Button variant="outline" onClick={() => window.location.href = '/'}>
                            Back to Home
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-4">
                <Card className="max-w-md w-full border-t-4 border-t-green-500 shadow-xl overflow-hidden">
                    <div className="bg-green-50 dark:bg-green-900/10 py-10 text-center">
                        <CheckCircle2 className="h-20 w-20 text-green-500 mx-auto animate-bounce" />
                    </div>
                    <CardHeader className="text-center pb-2">
                        <CardTitle className="text-2xl font-bold text-green-600 dark:text-green-400">Update Received!</CardTitle>
                        <CardDescription className="text-base mt-2 px-4">
                            Your update for <strong>{assignment.ticket_id}</strong> has been successfully recorded.
                            The admin has been notified.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center pb-8 pt-4">
                        <p className="text-sm text-muted-foreground">You can now safely close this window.</p>
                        <Button
                            className="mt-6 bg-green-600 hover:bg-green-700 text-white px-8"
                            onClick={() => setSubmitted(false)}
                        >
                            Modify Update
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const getStatusVariant = (s: string) => {
        switch (s) {
            case 'completed': return 'success';
            case 'in_progress': return 'warning';
            default: return 'secondary';
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-4">
            <div className="max-w-3xl mx-auto space-y-6">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 px-2">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="p-2 bg-orange-500 rounded-lg text-white">
                                <MessageSquare className="h-5 w-5" />
                            </span>
                            <h2 className="text-sm font-semibold uppercase tracking-wider text-orange-500">Complaint Assignment</h2>
                        </div>
                        <h1 className="text-3xl font-extrabold tracking-tight dark:text-white">
                            Task Update Portal
                        </h1>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Left Column: Details */}
                    <div className="md:col-span-1 space-y-6">
                        <Card className="shadow-lg border-2 border-slate-100 dark:border-slate-800">
                            <CardHeader className="bg-slate-50 dark:bg-slate-900/50 rounded-t-lg">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Clock className="h-4 w-4" />
                                    Quick Info
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-6 space-y-4 text-sm">
                                <div>
                                    <p className="text-muted-foreground mb-1">Ticket ID</p>
                                    <p className="font-bold text-base">{assignment.ticket_id}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground mb-1">Assignee</p>
                                    <div className="flex items-center gap-2">
                                        <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-500">
                                            {assignment.assignee_name?.[0]}
                                        </div>
                                        <p className="font-semibold">{assignment.assignee_name}</p>
                                    </div>
                                </div>
                                {assignment.estimated_completion_date && (
                                    <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-100 dark:border-red-900/30">
                                        <p className="text-red-600 dark:text-red-400 text-xs font-semibold mb-1 flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            EXPECTED RESOLUTION
                                        </p>
                                        <p className="font-bold text-red-700 dark:text-red-300">
                                            {new Date(assignment.estimated_completion_date).toLocaleDateString('en-IN', {
                                                day: 'numeric',
                                                month: 'long',
                                                year: 'numeric'
                                            })}
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="shadow-lg border-2 border-slate-100 dark:border-slate-800">
                            <CardHeader className="bg-slate-50 dark:bg-slate-900/50 rounded-t-lg">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4" />
                                    Category
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4">
                                <Badge className="text-sm font-medium">{assignment.category.replace(/_/g, ' ').toUpperCase()}</Badge>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right Column: Update Form */}
                    <div className="md:col-span-2 space-y-6">
                        <Card className="shadow-xl border-2 border-slate-100 dark:border-slate-800 overflow-hidden">
                            <div className="h-2 bg-gradient-to-r from-orange-500 to-red-500"></div>
                            <CardHeader>
                                <CardTitle>Complaint Details</CardTitle>
                                <CardDescription>Below are the details shared by the customer</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="p-4 bg-gray-50 dark:bg-slate-900 rounded-lg">
                                    <h4 className="font-bold text-lg mb-2">{assignment.subject}</h4>
                                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                                        {assignment.description}
                                    </p>
                                </div>
                                {assignment.remarks && (
                                    <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border-l-4 border-blue-500 rounded-r-lg">
                                        <h5 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase mb-1">Admin Instructions</h5>
                                        <p className="text-sm italic">{assignment.remarks}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="shadow-xl border-2 border-orange-100 dark:border-orange-900/30">
                            <CardHeader>
                                <CardTitle>Submit Progress Update</CardTitle>
                                <CardDescription>Update the task status and provide necessary remarks</CardDescription>
                            </CardHeader>
                            <form onSubmit={handleSubmit}>
                                <CardContent className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold flex items-center gap-2">
                                            Current Status
                                            <Badge variant={getStatusVariant(status) as any} className="ml-auto">
                                                {status.replace(/_/g, ' ').toUpperCase()}
                                            </Badge>
                                        </label>
                                        <Select value={status} onValueChange={setStatus}>
                                            <SelectTrigger className="w-full text-lg h-12 border-2 focus:ring-orange-500">
                                                <SelectValue placeholder="Select current status" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="pending">
                                                    <div className="flex items-center gap-2 py-1">
                                                        <Clock className="h-4 w-4 text-slate-400" />
                                                        <span>Pending / Not Started</span>
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="in_progress">
                                                    <div className="flex items-center gap-2 py-1">
                                                        <Loader2 className="h-4 w-4 text-orange-400 animate-spin-slow" />
                                                        <span>In Progress / Working</span>
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="completed">
                                                    <div className="flex items-center gap-2 py-1">
                                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                        <span>Resolved / Completed</span>
                                                    </div>
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold">Update Remarks</label>
                                        <Textarea
                                            placeholder="Ex: Contacted customer, issue clarified, or parts ordered..."
                                            value={remarks}
                                            onChange={(e) => setRemarks(e.target.value)}
                                            className="min-h-[120px] border-2 focus:ring-orange-500 text-base"
                                            required={status === 'completed'}
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            {status === 'completed' ? 'Remarks are mandatory for marked as completed.' : 'Optional: provide a brief update on proof of work.'}
                                        </p>
                                    </div>
                                </CardContent>
                                <CardFooter className="bg-slate-50 dark:bg-slate-900/50 p-6">
                                    <Button
                                        type="submit"
                                        className="w-full h-12 text-lg font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-lg shadow-orange-500/20"
                                        disabled={submitting || (status === assignment.status && remarks === '') || (status === 'completed' && !remarks.trim())}
                                    >
                                        {submitting ? (
                                            <>
                                                <Loader2 className="h-5 w-5 mr-3 animate-spin" />
                                                Sending Update...
                                            </>
                                        ) : (
                                            <>
                                                Submit Task Update
                                                <ArrowRight className="h-5 w-5 ml-2" />
                                            </>
                                        )}
                                    </Button>
                                </CardFooter>
                            </form>
                        </Card>
                    </div>
                </div>

                <footer className="text-center text-xs text-muted-foreground pb-10 mt-10">
                    &copy; {getISTYear()} Autoform India - Secured Task Portal
                </footer>
            </div>
        </div>
    );
}
