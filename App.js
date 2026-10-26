import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, StatusBar, Alert } from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { supabase } from './supabase';
import Auth from './Auth';

const C = {
  bg: '#14131F', card: '#1D1C2C', line: '#2B2A3F', text: '#F2F0FA', dim: '#8B89A3',
};
const KINDS = {
  criacao: { label: 'Criação', hint: 'Alto impacto', color: '#FFC857' },
  gestao: { label: 'Gestão', hint: 'Necessário, com limite', color: '#8FA3D1' },
  recarga: { label: 'Recarga', hint: 'Inspiração e pausas', color: '#7FD6B2' },
};
const FOCUS_OPTIONS = [25, 45, 60, 90];
const STORE = 'creation-tracker:v1';

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${pad(Math.round(min % 60))}` : `${Math.round(min)} min`);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = carregando
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setUser(sess?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (user === undefined) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  return <SafeAreaProvider>{user ? <Tracker /> : <Auth />}</SafeAreaProvider>;
}

function Tracker() {
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null); // { kind, start, target }
  const [kind, setKind] = useState('criacao');
  const [focusMin, setFocusMin] = useState(45);
  const [now, setNow] = useState(Date.now());
  const [rating, setRating] = useState(null); // sessão aguardando nota
  const [tab, setTab] = useState('hoje');
  const [loaded, setLoaded] = useState(false);
  const buzzed = useRef(false);

  useEffect(() => {
    // o bloco em andamento fica local; as sessões finalizadas vêm do Postgres
    AsyncStorage.getItem(STORE).then((raw) => raw && setActive(JSON.parse(raw))).catch(() => {});
    supabase
      .from('sessions')
      .select('*')
      .order('started_at')
      .then(({ data, error }) => {
        if (error) Alert.alert('Erro ao carregar', error.message);
        else
          setSessions(
            data.map((r) => ({ id: r.id, kind: r.kind, start: Date.parse(r.started_at), end: Date.parse(r.ended_at), rating: r.rating }))
          );
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (active) AsyncStorage.setItem(STORE, JSON.stringify(active)).catch(() => {});
    else AsyncStorage.removeItem(STORE).catch(() => {});
  }, [active, loaded]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = active ? active.target * 60000 - (now - active.start) : 0;
  useEffect(() => {
    if (active && remaining <= 0 && !buzzed.current) {
      buzzed.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [remaining, active]);

  const start = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    buzzed.current = false;
    setActive({ kind, start: Date.now(), target: kind === 'recarga' ? 15 : focusMin });
  };

  const finish = () => {
    setRating({ kind: active.kind, start: active.start, end: Date.now() });
    setActive(null);
  };

  const saveRating = async (value) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        kind: rating.kind,
        started_at: new Date(rating.start).toISOString(),
        ended_at: new Date(rating.end).toISOString(),
        rating: value,
      })
      .select()
      .single();
    if (error) return Alert.alert('Não foi possível salvar', error.message);
    setSessions((s) => [...s, { ...rating, id: data.id, rating: value }]);
    setRating(null);
  };

  const today = useMemo(() => sessions.filter((s) => sameDay(s.start, now)), [sessions, now]);
  const totals = useMemo(() => {
    const t = { criacao: 0, gestao: 0, recarga: 0 };
    today.forEach((s) => (t[s.kind] += (s.end - s.start) / 60000));
    return t;
  }, [today]);
  const total = totals.criacao + totals.gestao + totals.recarga;

  const alert = useMemo(() => {
    // minutos seguidos de Gestão no fim do dia (intervalos < 30 min contam como contínuos)
    let run = 0, lastStart = null;
    for (let i = today.length - 1; i >= 0; i--) {
      const s = today[i];
      if (s.kind !== 'gestao') break;
      if (lastStart && lastStart - s.end > 30 * 60000) break;
      run += (s.end - s.start) / 60000;
      lastStart = s.start;
    }
    if (run >= 180) return `Você passou ${hm(run)} seguidas em Gestão. Reserve o próximo bloco para Criação.`;
    if (new Date(now).getHours() >= 11 && totals.criacao === 0)
      return 'Já passou das 11h e você ainda não criou nada hoje. Comece com um bloco de Criação.';
    return null;
  }, [today, totals, now]);

  const focusMap = useMemo(() => {
    const rated = sessions.filter((s) => s.kind === 'criacao' && s.rating);
    const byHour = {};
    rated.forEach((s) => {
      const h = new Date(s.start).getHours();
      (byHour[h] = byHour[h] || []).push(s.rating);
    });
    const avg = Object.fromEntries(
      Object.entries(byHour).map(([h, r]) => [h, r.reduce((a, b) => a + b, 0) / r.length])
    );
    const overall = rated.length ? rated.reduce((a, s) => a + s.rating, 0) / rated.length : 0;
    const best = Object.entries(avg).sort((a, b) => b[1] - a[1])[0];
    return { avg, overall, best, count: rated.length };
  }, [sessions]);

  return (
    <>
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="light-content" />
        <View style={s.tabs}>
          {['hoje', 'ritmo'].map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabOn]}>
              <Text style={[s.tabTxt, tab === t && { color: C.text }]}>{t === 'hoje' ? 'Hoje' : 'Mapa do Foco'}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => supabase.auth.signOut()} style={{ marginLeft: 'auto', padding: 8 }}>
            <Text style={s.dim}>Sair</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          {tab === 'hoje' ? (
            <>
              {/* Cronômetro */}
              <View style={s.timerCard}>
                {active ? (
                  <>
                    <Text style={[s.small, { color: KINDS[active.kind].color }]}>{KINDS[active.kind].label} em andamento</Text>
                    <Text style={s.timer}>{remaining < 0 ? '+' : ''}{clock(remaining)}</Text>
                    <Text style={s.dim}>{remaining < 0 ? 'Tempo esgotado. Finalize quando parar.' : `Bloco de ${active.target} min`}</Text>
                    <Pressable style={[s.cta, { backgroundColor: KINDS[active.kind].color }]} onPress={finish}>
                      <Text style={s.ctaTxt}>Finalizar bloco</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={s.title}>Que tipo de tempo é este?</Text>
                    <View style={s.kinds}>
                      {Object.entries(KINDS).map(([k, v]) => (
                        <Pressable
                          key={k}
                          onPress={() => { Haptics.selectionAsync(); setKind(k); }}
                          style={[s.kind, kind === k && { borderColor: v.color, backgroundColor: v.color + '1A' }]}
                        >
                          <View style={[s.dot, { backgroundColor: v.color }]} />
                          <Text style={s.kindTxt}>{v.label}</Text>
                          <Text style={s.hint}>{v.hint}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {kind !== 'recarga' && (
                      <View style={s.chips}>
                        {FOCUS_OPTIONS.map((m) => (
                          <Pressable key={m} onPress={() => setFocusMin(m)} style={[s.chip, focusMin === m && s.chipOn]}>
                            <Text style={[s.chipTxt, focusMin === m && { color: C.bg }]}>{m} min</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    <Pressable style={[s.cta, { backgroundColor: KINDS[kind].color }]} onPress={start}>
                      <Text style={s.ctaTxt}>Iniciar {KINDS[kind].label.toLowerCase()}</Text>
                    </Pressable>
                  </>
                )}
              </View>

              {alert && (
                <View style={s.alert}>
                  <Text style={s.alertTxt}>{alert}</Text>
                </View>
              )}

              {/* Índice de valor do dia */}
              <Text style={s.section}>Seu dia até agora</Text>
              {total === 0 ? (
                <Text style={s.dim}>Nenhum bloco registrado hoje. Inicie o primeiro acima.</Text>
              ) : (
                <>
                  <View style={s.bar}>
                    {Object.keys(KINDS).map((k) =>
                      totals[k] > 0 ? <View key={k} style={{ flex: totals[k], backgroundColor: KINDS[k].color }} /> : null
                    )}
                  </View>
                  {Object.entries(KINDS).map(([k, v]) => (
                    <View key={k} style={s.row}>
                      <View style={[s.dot, { backgroundColor: v.color }]} />
                      <Text style={s.rowLabel}>{v.label}</Text>
                      <Text style={s.rowVal}>{hm(totals[k])}  ·  {Math.round((totals[k] / total) * 100)}%</Text>
                    </View>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              <Text style={s.title}>Quando você cria melhor</Text>
              {focusMap.count < 5 ? (
                <Text style={[s.dim, { marginTop: 8 }]}>
                  Avalie pelo menos 5 blocos de Criação para ver seu padrão. Faltam {5 - focusMap.count}.
                </Text>
              ) : (
                <>
                  <Text style={s.insight}>
                    Você rende {Math.round((focusMap.best[1] / focusMap.overall - 1) * 100)}% acima da sua média em Criação
                    por volta das {pad(focusMap.best[0])}:00.
                  </Text>
                  <View style={s.hours}>
                    {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => {
                      const v = focusMap.avg[h] || 0;
                      return (
                        <View key={h} style={s.hourCol}>
                          <View style={[s.hourBar, { height: (v / 5) * 110, backgroundColor: String(h) === focusMap.best[0] ? KINDS.criacao.color : C.line }]} />
                          <Text style={s.hourLbl}>{h % 3 === 0 ? h : ''}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <Text style={s.dim}>Nota média de foco por hora de início (1 a 5).</Text>
                </>
              )}
            </>
          )}
        </ScrollView>

        {/* Nota ao final da sessão */}
        <Modal visible={!!rating} transparent animationType="fade">
          <View style={s.modalBg}>
            <View style={s.modal}>
              <Text style={s.title}>Como foi seu foco?</Text>
              <Text style={[s.dim, { marginBottom: 16 }]}>1 = disperso, 5 = fluxo total</Text>
              <View style={s.chips}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} style={s.rate} onPress={() => saveRating(n)}>
                    <Text style={s.rateTxt}>{n}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={() => saveRating(null)}>
                <Text style={[s.dim, { textAlign: 'center', marginTop: 14 }]}>Salvar sem nota</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  tabs: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20 },
  tabOn: { backgroundColor: C.card },
  tabTxt: { color: C.dim, fontSize: 15, fontWeight: '600' },
  timerCard: { backgroundColor: C.card, borderRadius: 24, padding: 22, borderWidth: 1, borderColor: C.line },
  timer: { color: C.text, fontSize: 68, fontWeight: '200', textAlign: 'center', marginVertical: 10, fontVariant: ['tabular-nums'] },
  title: { color: C.text, fontSize: 20, fontWeight: '700' },
  small: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  dim: { color: C.dim, fontSize: 14, textAlign: 'center' },
  kinds: { flexDirection: 'row', gap: 8, marginTop: 16 },
  kind: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 16, padding: 12 },
  kindTxt: { color: C.text, fontWeight: '700', fontSize: 15, marginTop: 8 },
  hint: { color: C.dim, fontSize: 11, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 16 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.text, borderColor: C.text },
  chipTxt: { color: C.dim, fontWeight: '600' },
  cta: { marginTop: 20, paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
  ctaTxt: { color: C.bg, fontSize: 17, fontWeight: '800' },
  alert: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: '#FFC85722', borderLeftWidth: 3, borderLeftColor: KINDS.criacao.color },
  alertTxt: { color: C.text, fontSize: 14, lineHeight: 20 },
  section: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 28, marginBottom: 12 },
  bar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: C.line, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  rowLabel: { color: C.text, fontSize: 15, flex: 1 },
  rowVal: { color: C.dim, fontSize: 15 },
  insight: { color: C.text, fontSize: 18, lineHeight: 26, marginVertical: 16 },
  hours: { flexDirection: 'row', alignItems: 'flex-end', height: 130, marginBottom: 12 },
  hourCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  hourBar: { width: 10, borderRadius: 5, minHeight: 4 },
  hourLbl: { color: C.dim, fontSize: 10, marginTop: 6, height: 12 },
  modalBg: { flex: 1, backgroundColor: '#000A', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: C.card, borderRadius: 24, padding: 24 },
  rate: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.line, alignItems: 'center', justifyContent: 'center' },
  rateTxt: { color: C.text, fontSize: 18, fontWeight: '700' },
});
