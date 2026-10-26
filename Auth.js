import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from './supabase';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (signUp) => {
    setBusy(true);
    const creds = { email: email.trim(), password };
    const { data, error } = signUp ? await supabase.auth.signUp(creds) : await supabase.auth.signInWithPassword(creds);
    setBusy(false);
    if (error) Alert.alert('Não foi possível entrar', error.message);
    else if (signUp && !data.session) Alert.alert('Confirme seu e-mail', 'Enviamos um link de confirmação. Depois de confirmar, volte e entre.');
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.box}>
        <Text style={s.title}>Creation Tracker</Text>
        <Text style={s.dim}>Entre para salvar seu tempo na nuvem.</Text>
        <TextInput style={s.input} placeholder="E-mail" placeholderTextColor="#8B89A3" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <TextInput style={s.input} placeholder="Senha (mín. 6 caracteres)" placeholderTextColor="#8B89A3" secureTextEntry value={password} onChangeText={setPassword} />
        <Pressable style={[s.cta, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => submit(false)}>
          <Text style={s.ctaTxt}>Entrar</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => submit(true)}>
          <Text style={[s.dim, { textAlign: 'center', marginTop: 16 }]}>Criar conta</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#14131F', justifyContent: 'center' },
  box: { padding: 24 },
  title: { color: '#F2F0FA', fontSize: 28, fontWeight: '700', marginBottom: 6 },
  dim: { color: '#8B89A3', fontSize: 14 },
  input: { backgroundColor: '#1D1C2C', borderColor: '#2B2A3F', borderWidth: 1, borderRadius: 14, color: '#F2F0FA', padding: 14, marginTop: 14, fontSize: 16 },
  cta: { backgroundColor: '#FFC857', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 22 },
  ctaTxt: { color: '#14131F', fontSize: 17, fontWeight: '800' },
});
