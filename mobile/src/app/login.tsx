import React, { useEffect, useRef, useState } from 'react';
import { Image, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Button } from '../components/ui';
import { errorMessage } from '../lib/api';
import { registerForPush } from '../lib/push';
import { useStore } from '../lib/store';
import { colors } from '../lib/theme';
import { useToast } from '../lib/toast';

export default function LoginScreen() {
  const router = useRouter();
  const toast = useToast();
  const { sessionLoaded, signedIn, signIn, refresh } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pwRef = useRef<TextInput>(null);

  useEffect(() => {
    if (err) setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password]);

  if (sessionLoaded && signedIn) return <Redirect href="/" />;

  const onSubmit = async () => {
    Keyboard.dismiss();
    if (!email.trim() || !password) {
      setErr('Enter your email and password.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const s = await signIn(email, password);
      toast.show(`Welcome, ${s.staff.name}.`, 'success');
      refresh().catch(() => {});
      registerForPush({ force: true, ask: true }).catch(() => {});
      router.replace('/');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} accessibilityIgnoresInvertColors />
          <Text style={styles.title}>LeadStream</Text>
          <Text style={styles.subtitle}>USA Home Repairs · lead alerts</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@usahomerepairs.net"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => pwRef.current?.focus()}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            ref={pwRef}
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />
          {err ? <Text style={styles.error}>{err}</Text> : null}
          <Button title="Sign in" variant="primary" onPress={onSubmit} loading={busy} style={styles.btn} />
          <Text style={styles.hint}>No account? Ask the office to add you on the admin dashboard.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 24 },
  brand: { alignItems: 'center', gap: 6 },
  logo: { width: 84, height: 84, borderRadius: 20, marginBottom: 6 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 14 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    gap: 8,
  },
  label: { color: colors.muted, fontSize: 13, marginTop: 4 },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 16,
  },
  error: { color: colors.red, fontSize: 13, marginTop: 4 },
  btn: { marginTop: 10 },
  hint: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
