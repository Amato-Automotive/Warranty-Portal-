import { App } from '@capacitor/app';
import { isNativeApp } from './nativeSession';

// Android's back button closes the app by default. Inside the app it should
// go back a page, and only leave the app from the first page.
if (isNativeApp) {
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
