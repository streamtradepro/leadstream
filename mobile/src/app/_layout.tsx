import React, { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from '../lib/store';
import { ToastProvider } from '../lib/toast';
import { registerForPush } from '../lib/push';
import { colors } from '../lib/theme';

/**
 * Runs once the store has read SecureStore:
 *  - re-registers the push token if it changed since last time (no-op otherwise)
 *  - routes notification taps to the matching lead
 */
function Boot() {
  const router = useRouter();
  const { configLoaded, configured, ensureByRedditId } = useStore();
  const registeredOnce = useRef(false);
  const lastHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!configLoaded || !configured || registeredOnce.current) return;
    registeredOnce.current = true;
    // Permission was already requested during setup; don't re-prompt on start.
    registerForPush({ ask: false }).catch(() => {});
  }, [configLoaded, configured]);

  const handleResponse = useCallback(
    async (resp: Notifications.NotificationResponse) => {
      const id = resp.notification.request.identifier;
      if (lastHandled.current === id) return;
      lastHandled.current = id;

      const data = (resp.notification.request.content.data ?? {}) as Record<string, unknown>;
      const redditId = typeof data.reddit_id === 'string' ? data.reddit_id : null;
      const url = typeof data.url === 'string' ? data.url : null;

      if (redditId) {
        const lead = await ensureByRedditId(redditId);
        if (lead) {
          const go = () => router.push(`/lead/${lead.id}`);
          try {
            go();
          } catch {
            // Cold start: the navigator may not be mounted yet. Retry shortly.
            setTimeout(() => {
              try {
                go();
              } catch {
                if (url) Linking.openURL(url).catch(() => {});
              }
            }, 600);
          }
          return;
        }
      }
      if (url) Linking.openURL(url).catch(() => {});
    },
    [ensureByRedditId, router],
  );

  useEffect(() => {
    if (!configLoaded) return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handleResponse(r);
    });
    // Notification that launched the app from a killed state.
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (r) handleResponse(r);
      })
      .catch(() => {});
    return () => sub.remove();
  }, [configLoaded, handleResponse]);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <ToastProvider>
          <StatusBar style="light" />
          <Boot />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.card },
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: '700', color: colors.text },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="index" options={{ title: 'LeadStream' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
            <Stack.Screen name="lead/[id]" options={{ title: 'Lead' }} />
          </Stack>
        </ToastProvider>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
