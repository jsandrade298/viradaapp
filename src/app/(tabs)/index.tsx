import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, ScrollView,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Image, Linking,
  Dimensions, StatusBar, Animated, Pressable, PanResponder, SafeAreaView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { Video, ResizeMode } from 'expo-av';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';

type AttachmentType = 'image' | 'video' | 'gif' | 'document' | null;
interface PostAttachment { uri: string; type: AttachmentType; mimeType?: string; fileName?: string; }
interface PostLocation { name: string; latitude: number; longitude: number; }
interface PollOption { text: string; votes: number; }
interface StoryGroup { sourceId: string; sourceName: string; isGlobal: boolean; stories: any[]; }

const { width: SW, height: SH } = Dimensions.get('window');
const STORY_MS = 6000;
const SWIPE_THRESHOLD = 60;

export default function FeedScreen() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // STORIES
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const storyGroupsRef = useRef<StoryGroup[]>([]);
  const [activeGroupIdx, setActiveGroupIdx] = useState<number | null>(null);
  const [activeStoryIdx, setActiveStoryIdx] = useState(0);
  const groupRef = useRef<number | null>(null);
  const storyRef = useRef(0);
  const progress = useRef(new Animated.Value(0)).current;
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [viewedGroups, setViewedGroups] = useState<Set<string>>(new Set());
  const timerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerStartedRef = useRef(0);
  const timerRemainingRef = useRef(STORY_MS);

  // POST MODAL
  const [isPostModalVisible, setIsPostModalVisible] = useState(false);
  const [newPostContent, setNewPostContent] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // ANEXOS
  const [attachment, setAttachment] = useState<PostAttachment | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>([]);
  const [showPollEditor, setShowPollEditor] = useState(false);
  const [postLocation, setPostLocation] = useState<PostLocation | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);

  // INTERAÇÕES
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});
  const [userInteractions, setUserInteractions] = useState<Record<string, string[]>>({});

  // COMENTÁRIOS (estilo X/Threads — fullscreen + threaded)
  const [commentModalPost, setCommentModalPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<any>(null); // Responder a comentário específico
  const commentInputRef = useRef<TextInput>(null);

  // BOTTOM SHEET / MEDIA VIEWER
  const [mediaPickerVisible, setMediaPickerVisible] = useState(false);
  const [mediaPickerType, setMediaPickerType] = useState<'image' | 'video'>('image');
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const [mediaViewer, setMediaViewer] = useState<{ url: string; type: string } | null>(null);

  // Sync refs
  useEffect(() => { storyGroupsRef.current = storyGroups; }, [storyGroups]);
  useEffect(() => { groupRef.current = activeGroupIdx; }, [activeGroupIdx]);
  useEffect(() => { storyRef.current = activeStoryIdx; }, [activeStoryIdx]);

  useEffect(() => { fetchCurrentUser(); fetchFeed(); return () => { if (timerIdRef.current) clearTimeout(timerIdRef.current); }; }, []);

  // Carregar votos do user ao logar
  useEffect(() => { if (currentUser) loadUserVotes(); }, [currentUser]);

  async function fetchCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single();
      setCurrentUser({ ...user, profile });
    }
  }

  // Carregar votos persistidos do banco
  async function loadUserVotes() {
    if (!currentUser) return;
    const { data } = await supabase.from('poll_votes').select('post_id, option_index').eq('user_id', currentUser.id);
    if (data) {
      const votes: Record<string, number> = {};
      data.forEach(v => { votes[v.post_id] = v.option_index; });
      setUserVotes(votes);
    }
  }

  // ========== FETCH FEED ==========
  async function fetchFeed() {
    const { data: ann } = await supabase.from('announcements').select('*, communities(id, name)')
      .gte('expires_at', new Date().toISOString()).order('created_at', { ascending: true });
    if (ann) {
      const gMap: Record<string, StoryGroup> = {};
      const globals = ann.filter(a => a.is_global);
      if (globals.length > 0) gMap['global'] = { sourceId: 'global', sourceName: 'Coordenação', isGlobal: true, stories: globals };
      ann.filter(a => !a.is_global && a.community_id).forEach(a => {
        const cid = a.community_id;
        if (!gMap[cid]) gMap[cid] = { sourceId: cid, sourceName: a.communities?.name || 'Comunidade', isGlobal: false, stories: [] };
        gMap[cid].stories.push(a);
      });
      const ordered: StoryGroup[] = [];
      if (gMap['global']) ordered.push(gMap['global']);
      Object.keys(gMap).filter(k => k !== 'global').forEach(k => ordered.push(gMap[k]));
      setStoryGroups(ordered);
    }

    const { data: feedPosts } = await supabase.from('posts')
      .select(`id, content, media_url, media_type, link_url, poll_options, location_name, latitude, longitude, created_at, author_id,
               profiles (full_name, avatar_url), communities (name), comments (count), post_interactions (count)`)
      .order('created_at', { ascending: false });
    if (feedPosts && feedPosts.length > 0) {
      const postIds = feedPosts.map(p => p.id);
      const { data: ints } = await supabase.from('post_interactions').select('post_id, interaction_type, user_id').in('post_id', postIds);
      const cMap: Record<string, { APOIAR: number; REPERCUTIR: number; SALVAR: number }> = {};
      const uInts: Record<string, string[]> = {};
      postIds.forEach(id => { cMap[id] = { APOIAR: 0, REPERCUTIR: 0, SALVAR: 0 }; });
      if (ints) ints.forEach(i => {
        if (cMap[i.post_id]) cMap[i.post_id][i.interaction_type as keyof typeof cMap[string]]++;
        if (currentUser && i.user_id === currentUser.id) { if (!uInts[i.post_id]) uInts[i.post_id] = []; uInts[i.post_id].push(i.interaction_type); }
      });
      setPosts(feedPosts.map(p => ({
        ...p, apoiar_count: cMap[p.id]?.APOIAR || 0, repercutir_count: cMap[p.id]?.REPERCUTIR || 0,
        salvar_count: cMap[p.id]?.SALVAR || 0,
        comment_count: Array.isArray(p.comments) ? p.comments.length : (p.comments as any)?.[0]?.count || 0,
      })));
      setUserInteractions(uInts);
    }
    setLoading(false);
  }

  // ========== INTERAÇÕES ==========
  async function toggleInteraction(postId: string, type: 'APOIAR' | 'REPERCUTIR' | 'SALVAR') {
    if (!currentUser) return;
    const cur = userInteractions[postId] || [];
    const has = cur.includes(type);
    if (has) {
      await supabase.from('post_interactions').delete().eq('post_id', postId).eq('user_id', currentUser.id).eq('interaction_type', type);
      setUserInteractions(p => ({ ...p, [postId]: (p[postId] || []).filter(t => t !== type) }));
      setPosts(p => p.map(x => x.id === postId ? { ...x, [`${type.toLowerCase()}_count`]: Math.max(0, x[`${type.toLowerCase()}_count`] - 1) } : x));
    } else {
      await supabase.from('post_interactions').insert({ post_id: postId, user_id: currentUser.id, interaction_type: type });
      setUserInteractions(p => ({ ...p, [postId]: [...(p[postId] || []), type] }));
      setPosts(p => p.map(x => x.id === postId ? { ...x, [`${type.toLowerCase()}_count`]: x[`${type.toLowerCase()}_count`] + 1 } : x));
    }
  }
  function hasInt(pid: string, t: string) { return (userInteractions[pid] || []).includes(t); }

  // ========== COMENTÁRIOS (threaded) ==========
  async function openComments(post: any) {
    setCommentModalPost(post);
    setReplyingTo(null);
    setNewComment('');
    setLoadingComments(true);
    const { data } = await supabase.from('comments').select('*, profiles(full_name, avatar_url)')
      .eq('post_id', post.id).order('created_at', { ascending: true });
    setComments(data || []);
    setLoadingComments(false);
  }

  async function sendComment() {
    if (!currentUser || !commentModalPost || !newComment.trim()) return;
    setSendingComment(true);
    const payload: any = { post_id: commentModalPost.id, author_id: currentUser.id, content: newComment.trim() };
    if (replyingTo) payload.parent_id = replyingTo.id;
    const { data, error } = await supabase.from('comments').insert(payload).select('*, profiles(full_name, avatar_url)').single();
    setSendingComment(false);
    if (!error && data) {
      setComments(prev => [...prev, data]);
      setNewComment('');
      setReplyingTo(null);
      setPosts(prev => prev.map(p => p.id === commentModalPost.id ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p));
    }
  }

  // Organizar comentários em árvore
  function getThreadedComments() {
    const roots = comments.filter(c => !c.parent_id);
    const childMap: Record<string, any[]> = {};
    comments.filter(c => c.parent_id).forEach(c => {
      if (!childMap[c.parent_id]) childMap[c.parent_id] = [];
      childMap[c.parent_id].push(c);
    });
    // Flatten: root, then its children
    const flat: { comment: any; isReply: boolean; parentAuthor?: string }[] = [];
    roots.forEach(r => {
      flat.push({ comment: r, isReply: false });
      (childMap[r.id] || []).forEach(child => {
        flat.push({ comment: child, isReply: true, parentAuthor: r.profiles?.full_name });
      });
    });
    return flat;
  }

  function formatTimeAgo(d: string): string {
    const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return 'agora'; if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  // ========== STORIES: TIMER ==========
  function clearStoryTimer() { if (timerIdRef.current) { clearTimeout(timerIdRef.current); timerIdRef.current = null; } }

  function runTimer(remaining: number = STORY_MS) {
    clearStoryTimer();
    progress.stopAnimation();
    progress.setValue(1 - (remaining / STORY_MS));
    timerStartedRef.current = Date.now();
    timerRemainingRef.current = remaining;
    Animated.timing(progress, { toValue: 1, duration: remaining, useNativeDriver: false }).start();
    timerIdRef.current = setTimeout(() => { timerIdRef.current = null; advanceStory(); }, remaining);
  }

  function advanceStory() {
    const gi = groupRef.current, si = storyRef.current, groups = storyGroupsRef.current;
    if (gi === null || !groups.length) return;
    clearStoryTimer(); progress.stopAnimation();
    if (si < groups[gi].stories.length - 1) {
      storyRef.current = si + 1; setActiveStoryIdx(si + 1); runTimer(STORY_MS);
    } else if (gi < groups.length - 1) {
      groupRef.current = gi + 1; storyRef.current = 0; setActiveGroupIdx(gi + 1); setActiveStoryIdx(0);
      if (!groups[gi + 1].isGlobal) setViewedGroups(p => new Set([...p, groups[gi + 1].sourceId]));
      runTimer(STORY_MS);
    } else { closeStories(); }
  }

  function prevStory() {
    const gi = groupRef.current, si = storyRef.current, groups = storyGroupsRef.current;
    if (gi === null) return;
    clearStoryTimer(); progress.stopAnimation();
    if (si > 0) { storyRef.current = si - 1; setActiveStoryIdx(si - 1); runTimer(STORY_MS); }
    else if (gi > 0) {
      const pg = gi - 1, li = groups[pg].stories.length - 1;
      groupRef.current = pg; storyRef.current = li; setActiveGroupIdx(pg); setActiveStoryIdx(li); runTimer(STORY_MS);
    }
  }

  // Pular para próximo/anterior GRUPO inteiro (swipe horizontal)
  function nextGroup() {
    const gi = groupRef.current, groups = storyGroupsRef.current;
    if (gi === null || gi >= groups.length - 1) return;
    clearStoryTimer(); progress.stopAnimation();
    const ng = gi + 1;
    groupRef.current = ng; storyRef.current = 0; setActiveGroupIdx(ng); setActiveStoryIdx(0);
    if (!groups[ng].isGlobal) setViewedGroups(p => new Set([...p, groups[ng].sourceId]));
    runTimer(STORY_MS);
  }

  function prevGroup() {
    const gi = groupRef.current, groups = storyGroupsRef.current;
    if (gi === null || gi <= 0) return;
    clearStoryTimer(); progress.stopAnimation();
    const pg = gi - 1;
    groupRef.current = pg; storyRef.current = 0; setActiveGroupIdx(pg); setActiveStoryIdx(0);
    runTimer(STORY_MS);
  }

  function openStoryGroup(idx: number) {
    clearStoryTimer(); progress.stopAnimation();
    groupRef.current = idx; storyRef.current = 0; setActiveGroupIdx(idx); setActiveStoryIdx(0);
    pausedRef.current = false; setPaused(false);
    const g = storyGroupsRef.current[idx];
    if (g && !g.isGlobal) setViewedGroups(p => new Set([...p, g.sourceId]));
    runTimer(STORY_MS);
  }

  function pauseStory() {
    if (pausedRef.current) return; // Já pausado
    pausedRef.current = true; setPaused(true);
    progress.stopAnimation(); clearStoryTimer();
    const elapsed = Date.now() - timerStartedRef.current;
    timerRemainingRef.current = Math.max(100, timerRemainingRef.current - elapsed);
  }
  function resumeStory() {
    if (!pausedRef.current) return;
    pausedRef.current = false; setPaused(false);
    runTimer(timerRemainingRef.current);
  }
  function closeStories() {
    clearStoryTimer(); progress.stopAnimation();
    groupRef.current = null; storyRef.current = 0; setActiveGroupIdx(null); setActiveStoryIdx(0);
    pausedRef.current = false; setPaused(false);
  }

  // Swipe gesture handler para stories
  const storyPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10,
    onPanResponderGrant: () => {
      // Segurar = pausar
      pauseStory();
    },
    onPanResponderRelease: (_, g) => {
      const { dx, dy } = g;
      if (dy > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
        // Swipe para baixo = fechar
        closeStories();
      } else if (dx < -SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        // Swipe esquerda = próximo grupo
        nextGroup();
      } else if (dx > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        // Swipe direita = grupo anterior
        prevGroup();
      } else if (Math.abs(dx) < 15 && Math.abs(dy) < 15) {
        // Tap (sem movimento significativo)
        // Determinar lado: esquerdo (1/3) vs direito (2/3)
        resumeStory();
        // Usar um setTimeout para processar o tap após o resume
        const tapX = g.x0;
        if (tapX < SW / 3) { prevStory(); }
        else { advanceStory(); }
      } else {
        // Movimento insuficiente para swipe, retomar
        resumeStory();
      }
    },
    onPanResponderTerminate: () => { resumeStory(); },
  })).current;

  function getSortedStoryGroups(): StoryGroup[] {
    const g = storyGroups.filter(x => x.isGlobal);
    const unseen = storyGroups.filter(x => !x.isGlobal && !viewedGroups.has(x.sourceId));
    const seen = storyGroups.filter(x => !x.isGlobal && viewedGroups.has(x.sourceId));
    return [...g, ...unseen, ...seen];
  }

  // ========== ENQUETE COM PERSISTÊNCIA ==========
  async function handlePollVote(pid: string, idx: number, opts: PollOption[]) {
    if (!currentUser) return;
    const prevVote = userVotes[pid];
    let updated: PollOption[];

    if (prevVote !== undefined) {
      // Mudar voto: decrementar antigo, incrementar novo
      if (prevVote === idx) return; // Mesmo voto
      updated = opts.map((o, i) => ({
        ...o,
        votes: i === prevVote ? Math.max(0, o.votes - 1) : i === idx ? o.votes + 1 : o.votes
      }));
      // Atualizar no banco: poll_votes
      await supabase.from('poll_votes').update({ option_index: idx }).eq('post_id', pid).eq('user_id', currentUser.id);
    } else {
      // Primeiro voto
      updated = opts.map((o, i) => ({ ...o, votes: i === idx ? o.votes + 1 : o.votes }));
      await supabase.from('poll_votes').insert({ post_id: pid, user_id: currentUser.id, option_index: idx });
    }

    // Atualizar poll_options no post
    await supabase.from('posts').update({ poll_options: updated }).eq('id', pid);
    setUserVotes(p => ({ ...p, [pid]: idx }));
    setPosts(p => p.map(x => x.id === pid ? { ...x, poll_options: updated } : x));
  }

  // ========== MEDIA / POST HELPERS ==========
  function resetPostModal() { setNewPostContent(''); setAttachment(null); setLinkUrl(''); setShowLinkInput(false); setPollOptions([]); setShowPollEditor(false); setPostLocation(null); setIsPostModalVisible(false); }
  function openMediaPicker(t: 'image'|'video') { if (attachment) setAttachment(null); setMediaPickerType(t); setMediaPickerVisible(true); Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start(); }
  function closeMediaPicker() { Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setMediaPickerVisible(false)); }
  function handleImageSelect() { openMediaPicker('image'); }
  function handleVideoSelect() { openMediaPicker('video'); }
  function handleGifSelect() { if (attachment) setAttachment(null); pickGif(); }
  function handleDocumentSelect() { if (attachment) setAttachment(null); pickDocument(); }

  async function pickImage(src: 'camera'|'gallery') {
    if (src === 'camera') { const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) { Alert.alert("Permissão negada"); return; } const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, allowsEditing: true, quality: 0.7 }); if (!r.canceled) setAttachment({ uri: r.assets[0].uri, type: 'image', mimeType: 'image/jpeg' }); }
    else { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, allowsEditing: true, quality: 0.7 }); if (!r.canceled) setAttachment({ uri: r.assets[0].uri, type: 'image', mimeType: r.assets[0].mimeType || 'image/jpeg' }); }
  }
  async function pickGif() { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 1 }); if (!r.canceled) setAttachment({ uri: r.assets[0].uri, type: 'gif', mimeType: 'image/gif' }); }
  async function pickVideo(src: 'camera'|'gallery') {
    if (src === 'camera') { const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) { Alert.alert("Permissão negada"); return; } const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'] as any, allowsEditing: true, videoMaxDuration: 120, quality: 0.7 }); if (!r.canceled) setAttachment({ uri: r.assets[0].uri, type: 'video', mimeType: r.assets[0].mimeType || 'video/mp4' }); }
    else { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] as any, allowsEditing: true, videoMaxDuration: 120, quality: 0.7 }); if (!r.canceled) setAttachment({ uri: r.assets[0].uri, type: 'video', mimeType: r.assets[0].mimeType || 'video/mp4' }); }
  }
  async function pickDocument() { try { const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'], copyToCacheDirectory: true }); if (!r.canceled && r.assets?.[0]) { const d = r.assets[0]; setAttachment({ uri: d.uri, type: 'document', mimeType: d.mimeType || 'application/octet-stream', fileName: d.name }); } } catch { Alert.alert("Erro"); } }

  function handleLinkToggle() { if (showLinkInput) { setShowLinkInput(false); setLinkUrl(''); } else setShowLinkInput(true); }
  function handlePollToggle() { if (showPollEditor) { setShowPollEditor(false); setPollOptions([]); } else { setShowPollEditor(true); if (!pollOptions.length) setPollOptions(['','']); } }
  function updatePollOption(i: number, t: string) { const u = [...pollOptions]; u[i] = t; setPollOptions(u); }
  function addPollOption() { pollOptions.length < 5 ? setPollOptions([...pollOptions, '']) : Alert.alert("Limite"); }
  function removePollOption(i: number) { pollOptions.length <= 2 ? Alert.alert("Mínimo") : setPollOptions(pollOptions.filter((_,j) => j !== i)); }
  async function handleLocationToggle() {
    if (postLocation) { setPostLocation(null); return; } setIsLoadingLocation(true);
    try { const { status } = await Location.requestForegroundPermissionsAsync(); if (status !== 'granted') { Alert.alert("Permissão negada"); setIsLoadingLocation(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }); const [addr] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      let name = 'Localização atual'; if (addr) { const p = [addr.street, addr.district, addr.city].filter(Boolean); name = p.join(', ') || addr.name || name; }
      setPostLocation({ name, latitude: loc.coords.latitude, longitude: loc.coords.longitude }); } catch { Alert.alert("Erro"); } setIsLoadingLocation(false);
  }

  async function uploadMedia(uid: string) {
    if (!attachment) return null;
    const ext = attachment.type === 'video' ? 'mp4' : attachment.type === 'gif' ? 'gif' : attachment.type === 'document' ? (attachment.fileName?.split('.').pop() || 'pdf') : 'jpg';
    const ct = attachment.mimeType || (attachment.type === 'video' ? 'video/mp4' : attachment.type === 'gif' ? 'image/gif' : 'image/jpeg');
    const fn = `${uid}/${Date.now()}.${ext}`;
    const b64 = await FileSystem.readAsStringAsync(attachment.uri, { encoding: 'base64' });
    const { error } = await supabase.storage.from('post_media').upload(fn, decode(b64), { contentType: ct, upsert: false });
    if (error) throw error;
    return { url: supabase.storage.from('post_media').getPublicUrl(fn).data.publicUrl, type: attachment.type || 'image' };
  }
  function canPublish() { return newPostContent.trim().length > 0 || !!attachment || (showLinkInput && linkUrl.trim().length > 0) || (showPollEditor && pollOptions.filter(o => o.trim()).length >= 2); }
  async function handleCreatePost() {
    if (!canPublish()) return;
    setIsPublishing(true);
    const { data: { user } } = await supabase.auth.getUser(); if (!user) { Alert.alert("Erro"); setIsPublishing(false); return; }
    let mUrl: string|null = null, mType: string|null = null;
    if (attachment) { try { const u = await uploadMedia(user.id); if (u) { mUrl = u.url; mType = u.type; } } catch { Alert.alert("Erro no Upload"); setIsPublishing(false); return; } }
    let fp: any = null;
    if (showPollEditor) { const v = pollOptions.filter(o => o.trim()); if (v.length >= 2) fp = v.map(t => ({ text: t.trim(), votes: 0 })); }
    const { error } = await supabase.from('posts').insert({ author_id: user.id, content: newPostContent.trim() || null, media_url: mUrl, media_type: mType, link_url: (showLinkInput && linkUrl.trim()) ? linkUrl.trim() : null, poll_options: fp, location_name: postLocation?.name || null, latitude: postLocation?.latitude || null, longitude: postLocation?.longitude || null });
    setIsPublishing(false);
    if (error) { Alert.alert("Erro"); console.error(error); } else { resetPostModal(); fetchFeed(); }
  }

  function getDocIcon(f?: string) { const e = f?.split('.').pop()?.toLowerCase(); if (e === 'pdf') return 'document-text'; if (['doc','docx'].includes(e||'')) return 'document'; if (['xls','xlsx'].includes(e||'')) return 'grid'; return 'document-text-outline'; }

  // ========== RENDER HELPERS ==========
  function renderPostMedia(item: any) {
    if (item.media_url && item.media_type === 'image') return <TouchableOpacity activeOpacity={0.9} onPress={() => setMediaViewer({ url: item.media_url, type: 'image' })}><Image source={{ uri: item.media_url }} className="w-full h-52 rounded-xl mb-4" resizeMode="cover" /></TouchableOpacity>;
    if (item.media_url && item.media_type === 'gif') return <TouchableOpacity activeOpacity={0.9} onPress={() => setMediaViewer({ url: item.media_url, type: 'gif' })} className="mb-4"><Image source={{ uri: item.media_url }} className="w-full h-52 rounded-xl" resizeMode="cover" /><View className="absolute top-2 left-2 bg-black/60 px-2 py-0.5 rounded"><Text className="text-white text-xs font-bold">GIF</Text></View></TouchableOpacity>;
    if (item.media_url && item.media_type === 'video') return <TouchableOpacity activeOpacity={0.9} onPress={() => setMediaViewer({ url: item.media_url, type: 'video' })} className="mb-4"><View className="w-full h-52 rounded-xl bg-zinc-800 overflow-hidden"><Video source={{ uri: item.media_url }} style={{ width: '100%', height: '100%' }} resizeMode={ResizeMode.COVER} shouldPlay isLooping isMuted /><View className="absolute bottom-2 right-2 flex-row"><View className="bg-black/60 p-1.5 rounded-full mr-1.5"><Ionicons name="volume-mute" size={14} color="white" /></View><View className="bg-black/60 p-1.5 rounded-full"><Ionicons name="expand" size={14} color="white" /></View></View></View></TouchableOpacity>;
    if (item.media_url && item.media_type === 'document') { const fn = decodeURIComponent(item.media_url.split('/').pop()||'Doc'); return <TouchableOpacity onPress={() => Linking.openURL(item.media_url)} className="bg-zinc-800 rounded-xl p-4 mb-4 flex-row items-center border border-zinc-700"><View className="w-12 h-12 bg-[#ff4500]/20 rounded-xl items-center justify-center mr-4"><Ionicons name={getDocIcon(fn) as any} size={24} color="#ff4500" /></View><View className="flex-1"><Text className="text-white font-bold text-sm" numberOfLines={1}>{fn}</Text></View><Ionicons name="download-outline" size={22} color="#9ca3af" /></TouchableOpacity>; }
    return null;
  }
  function renderPostLink(item: any) { if (!item.link_url) return null; return <TouchableOpacity onPress={() => Linking.openURL(item.link_url)} className="bg-zinc-800 rounded-xl p-4 mb-4 flex-row items-center border border-zinc-700"><View className="w-10 h-10 bg-blue-500/20 rounded-lg items-center justify-center mr-3"><Ionicons name="link" size={20} color="#3b82f6" /></View><View className="flex-1"><Text className="text-blue-400 text-sm font-medium" numberOfLines={2}>{item.link_url}</Text></View><Ionicons name="open-outline" size={18} color="#3b82f6" /></TouchableOpacity>; }
  function renderPostPoll(item: any) {
    if (!item.poll_options || !Array.isArray(item.poll_options)) return null;
    const opts: PollOption[] = item.poll_options;
    const total = opts.reduce((s,o) => s + (o.votes||0), 0);
    const voted = userVotes[item.id] !== undefined;
    return <View className="mb-4">{opts.map((o,i) => {
      const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
      const sel = userVotes[item.id] === i;
      return <TouchableOpacity key={i} onPress={() => handlePollVote(item.id, i, opts)} activeOpacity={0.7} className={`mb-2.5 rounded-xl overflow-hidden border ${sel ? 'border-[#ff4500]' : 'border-zinc-700'}`}>
        <View style={{ height: 48, justifyContent: 'center' }}>
          {voted && <View style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: Math.max((SW-74)*(pct/100), sel ? 8 : 0), backgroundColor: sel ? 'rgba(255,69,0,0.25)' : 'rgba(63,63,70,0.8)', borderRadius: 12 }} />}
          <View className="flex-row justify-between items-center px-4" style={{ zIndex: 1 }}>
            <View className="flex-row items-center flex-1">
              {voted && <View className={`w-5 h-5 rounded-full mr-2.5 items-center justify-center ${sel ? 'bg-[#ff4500]' : 'bg-zinc-600'}`}>{sel && <Ionicons name="checkmark" size={12} color="white" />}</View>}
              <Text className={`text-sm font-medium flex-1 ${sel ? 'text-white' : 'text-gray-200'}`}>{o.text}</Text>
            </View>
            {voted && <Text className={`text-sm font-bold ml-3 ${sel ? 'text-[#ff4500]' : 'text-gray-400'}`}>{pct}%</Text>}
          </View>
        </View>
      </TouchableOpacity>;
    })}<Text className="text-gray-500 text-xs mt-1 ml-1">{total} {total===1?'voto':'votos'}{voted ? ' · Toque para mudar' : ' · Toque para votar'}</Text></View>;
  }
  function renderPostLocation(item: any) { if (!item.location_name) return null; return <View className="flex-row items-center mb-3 mt-1"><Ionicons name="location" size={14} color="#ff4500" /><Text className="text-gray-400 text-xs ml-1">{item.location_name}</Text></View>; }
  function renderAttachmentPreview() {
    if (!attachment) return null;
    return <View className="mt-4 relative mb-4">
      {attachment.type === 'image' || attachment.type === 'gif' ? <Image source={{ uri: attachment.uri }} className="w-full h-48 rounded-xl" resizeMode="cover" />
      : attachment.type === 'video' ? <View className="w-full h-48 rounded-xl bg-zinc-800 items-center justify-center"><Ionicons name="videocam" size={40} color="#ff4500" /><Text className="text-gray-400 text-sm mt-2">Vídeo selecionado</Text></View>
      : attachment.type === 'document' ? <View className="w-full rounded-xl bg-zinc-800 p-4 flex-row items-center border border-zinc-700"><View className="w-12 h-12 bg-[#ff4500]/20 rounded-xl items-center justify-center mr-3"><Ionicons name={getDocIcon(attachment.fileName) as any} size={24} color="#ff4500" /></View><View className="flex-1"><Text className="text-white font-bold text-sm" numberOfLines={1}>{attachment.fileName||'Doc'}</Text></View></View> : null}
      {attachment.type === 'gif' && <View className="absolute top-2 left-2 bg-black/70 px-2 py-0.5 rounded"><Text className="text-white text-xs font-bold">GIF</Text></View>}
      <TouchableOpacity onPress={() => setAttachment(null)} className="absolute top-2 right-2 bg-black/70 p-1.5 rounded-full"><Ionicons name="close" size={20} color="white" /></TouchableOpacity>
    </View>;
  }

  if (loading) return <View className="flex-1 bg-[#1a1a1a] justify-center items-center"><ActivityIndicator size="large" color="#ff4500" /></View>;

  const activeGroup = activeGroupIdx !== null ? storyGroupsRef.current[activeGroupIdx] : null;
  const activeStory = activeGroup?.stories[activeStoryIdx] || null;
  const sortedGroups = getSortedStoryGroups();
  const threadedComments = commentModalPost ? getThreadedComments() : [];

  return (
    <View className="flex-1 bg-[#1a1a1a]">
      {/* HEADER */}
      <View className="pt-14 pb-4 px-6 flex-row justify-between items-center bg-[#1a1a1a] border-b border-zinc-800">
        <Text className="text-white text-2xl font-black tracking-wide">Mobiliza</Text>
        <View className="flex-row items-center">
          <TouchableOpacity className="mr-5 relative"><Ionicons name="notifications-outline" size={24} color="white" /><View className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#ff4500] rounded-full border border-[#1a1a1a]" /></TouchableOpacity>
          <TouchableOpacity><Ionicons name="chatbubbles-outline" size={24} color="white" /></TouchableOpacity>
        </View>
      </View>

      {/* FEED */}
      <FlatList data={posts} keyExtractor={i => i.id} contentContainerStyle={{ padding: 16, paddingBottom: 100 }} showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View className="mb-6">
            <Text className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-4 ml-1">Radar de Ações</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {sortedGroups.map(group => {
                const realIdx = storyGroups.findIndex(g => g.sourceId === group.sourceId);
                const isViewed = viewedGroups.has(group.sourceId) && !group.isGlobal;
                return (
                  <TouchableOpacity key={group.sourceId} onPress={() => openStoryGroup(realIdx)} className="items-center mr-5 ml-1" style={isViewed ? { opacity: 0.45 } : undefined}>
                    <View className={`${group.isGlobal ? 'w-[68px] h-[68px]' : 'w-16 h-16'} rounded-full border-2 ${group.isGlobal ? 'border-red-500' : isViewed ? 'border-zinc-600' : 'border-[#ff4500]'} p-[2px] items-center justify-center mb-1`}>
                      <View className={`flex-1 w-full h-full rounded-full ${group.isGlobal ? 'bg-red-900/80' : 'bg-zinc-800'} items-center justify-center`}>
                        {group.isGlobal ? <Ionicons name="megaphone" size={28} color="#ffffff" /> : <Text className="text-white font-bold text-xl">{group.sourceName.charAt(0)}</Text>}
                      </View>
                    </View>
                    {group.isGlobal && <View className="absolute bottom-4 bg-red-600 px-2 py-0.5 rounded border border-[#1a1a1a]"><Text className="text-white text-[9px] font-black uppercase tracking-wider">Urgente</Text></View>}
                    <Text className={`${group.isGlobal ? 'text-red-400 font-bold' : isViewed ? 'text-zinc-500' : 'text-gray-300'} text-xs text-center w-16 mt-1`} numberOfLines={1}>{group.sourceName}</Text>
                    {group.stories.length > 1 && <Text className="text-zinc-500 text-[10px]">{group.stories.length}</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
        renderItem={({ item }) => (
          <View className="bg-zinc-900 rounded-xl p-5 mb-4 border border-zinc-800">
            <View className="flex-row items-center mb-4">
              <View className="w-10 h-10 bg-zinc-700 rounded-full items-center justify-center"><Text className="text-white font-bold text-lg">{item.profiles?.full_name?.charAt(0)||'?'}</Text></View>
              <View className="ml-3 flex-1">
                <View className="flex-row items-center"><Text className="text-white font-bold text-base mr-2">{item.profiles?.full_name}</Text><Text className="text-gray-500 text-xs">{formatTimeAgo(item.created_at)}</Text></View>
                <View className="flex-row items-center mt-0.5"><Ionicons name="people" size={12} color="#9ca3af" /><Text className="text-gray-400 text-xs ml-1 font-medium">{item.communities?.name||'Feed Geral'}</Text></View>
              </View>
            </View>
            {item.content ? <Text className="text-gray-200 text-base leading-6 mb-4">{item.content}</Text> : null}
            {renderPostLocation(item)}
            {renderPostMedia(item)}
            {renderPostLink(item)}
            {renderPostPoll(item)}
            <View className="flex-row items-center justify-between border-t border-zinc-800 pt-4 px-1">
              <View className="flex-row items-center">
                <TouchableOpacity onPress={() => toggleInteraction(item.id, 'APOIAR')} className="flex-row items-center mr-7"><Ionicons name={hasInt(item.id,'APOIAR') ? 'flame' : 'flame-outline'} size={22} color={hasInt(item.id,'APOIAR') ? '#ff4500' : '#9ca3af'} /><Text className={`text-sm font-medium ml-1.5 ${hasInt(item.id,'APOIAR') ? 'text-[#ff4500]' : 'text-gray-400'}`}>{item.apoiar_count||0}</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => openComments(item)} className="flex-row items-center mr-7"><Ionicons name="chatbubble-outline" size={20} color="#9ca3af" /><Text className="text-gray-400 text-sm font-medium ml-1.5">{item.comment_count||0}</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => toggleInteraction(item.id, 'REPERCUTIR')} className="flex-row items-center"><Ionicons name={hasInt(item.id,'REPERCUTIR') ? 'repeat' : 'repeat-outline'} size={22} color={hasInt(item.id,'REPERCUTIR') ? '#10b981' : '#9ca3af'} /><Text className={`text-sm font-medium ml-1.5 ${hasInt(item.id,'REPERCUTIR') ? 'text-emerald-500' : 'text-gray-400'}`}>{item.repercutir_count||0}</Text></TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => toggleInteraction(item.id, 'SALVAR')}><Ionicons name={hasInt(item.id,'SALVAR') ? 'bookmark' : 'bookmark-outline'} size={22} color={hasInt(item.id,'SALVAR') ? '#f59e0b' : '#9ca3af'} /></TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* FAB */}
      <TouchableOpacity onPress={() => setIsPostModalVisible(true)} className="absolute bottom-6 right-6 w-14 h-14 bg-[#ff4500] rounded-full items-center justify-center shadow-2xl elevation-5" activeOpacity={0.8}><Ionicons name="add" size={32} color="#ffffff" /></TouchableOpacity>

      {/* ===== MODAL POSTAGEM ===== */}
      <Modal visible={isPostModalVisible} animationType="slide" transparent={false} onRequestClose={resetPostModal} onShow={() => setTimeout(() => inputRef.current?.focus(), 100)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-[#1a1a1a]">
          <View className="flex-row justify-between items-center px-4 pt-14 pb-4 border-b border-zinc-800">
            <TouchableOpacity onPress={resetPostModal}><Text className="text-gray-400 font-bold text-base">Cancelar</Text></TouchableOpacity>
            <TouchableOpacity onPress={handleCreatePost} className={`${canPublish() ? 'bg-[#ff4500]' : 'bg-zinc-700'} px-5 py-2 rounded-full min-w-[80px] items-center`} disabled={!canPublish() || isPublishing}>
              {isPublishing ? <ActivityIndicator size="small" color="#fff" /> : <Text className={`${canPublish() ? 'text-white' : 'text-gray-400'} font-bold text-sm`}>Publicar</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-4 pt-5" keyboardShouldPersistTaps="handled">
            <View className="flex-row">
              <View className="w-10 h-10 bg-zinc-700 rounded-full items-center justify-center mr-3 mt-1"><Text className="text-white font-bold text-lg">{currentUser?.profile?.full_name?.charAt(0)||'?'}</Text></View>
              <View className="flex-1">
                <TextInput ref={inputRef} className="text-white text-lg leading-7" placeholder="O que está organizando hoje?" placeholderTextColor="#6b7280" multiline value={newPostContent} onChangeText={setNewPostContent} style={{ textAlignVertical: 'top', minHeight: attachment || showPollEditor || showLinkInput ? 80 : 200 }} />
                {renderAttachmentPreview()}
                {postLocation && <View className="flex-row items-center bg-zinc-800 rounded-lg px-3 py-2 mb-4"><Ionicons name="location" size={16} color="#ff4500" /><Text className="text-gray-300 text-sm ml-2 flex-1" numberOfLines={1}>{postLocation.name}</Text><TouchableOpacity onPress={() => setPostLocation(null)}><Ionicons name="close-circle" size={18} color="#9ca3af" /></TouchableOpacity></View>}
                {showLinkInput && <View className="mb-4"><View className="flex-row items-center bg-zinc-800 rounded-xl px-3 py-2 border border-zinc-700"><Ionicons name="link" size={18} color="#3b82f6" /><TextInput className="text-blue-400 text-sm ml-2 flex-1" placeholder="https://..." placeholderTextColor="#6b7280" value={linkUrl} onChangeText={setLinkUrl} autoCapitalize="none" keyboardType="url" /><TouchableOpacity onPress={() => { setShowLinkInput(false); setLinkUrl(''); }}><Ionicons name="close-circle" size={18} color="#9ca3af" /></TouchableOpacity></View></View>}
                {showPollEditor && <View className="mb-4 bg-zinc-800/50 rounded-xl p-4 border border-zinc-700"><View className="flex-row justify-between items-center mb-3"><Text className="text-white font-bold text-sm">Enquete</Text><TouchableOpacity onPress={() => { setShowPollEditor(false); setPollOptions([]); }}><Ionicons name="close-circle" size={20} color="#9ca3af" /></TouchableOpacity></View>
                  {pollOptions.map((o,i) => <View key={i} className="flex-row items-center mb-2"><View className="flex-1 bg-zinc-900 rounded-lg px-3 py-2.5 border border-zinc-700 flex-row items-center"><Text className="text-zinc-500 text-sm mr-2">{i+1}.</Text><TextInput className="text-white text-sm flex-1" placeholder={`Opção ${i+1}`} placeholderTextColor="#6b7280" value={o} onChangeText={t => updatePollOption(i,t)} maxLength={80} /></View>{pollOptions.length > 2 && <TouchableOpacity onPress={() => removePollOption(i)} className="ml-2"><Ionicons name="trash-outline" size={18} color="#ef4444" /></TouchableOpacity>}</View>)}
                  {pollOptions.length < 5 && <TouchableOpacity onPress={addPollOption} className="flex-row items-center justify-center py-2 mt-1"><Ionicons name="add-circle-outline" size={18} color="#ff4500" /><Text className="text-[#ff4500] text-sm font-medium ml-1">Adicionar opção</Text></TouchableOpacity>}
                </View>}
              </View>
            </View>
          </ScrollView>
          <View className="flex-row items-center justify-between px-5 py-4 bg-zinc-900 border-t border-zinc-800 pb-8">
            <View className="flex-row gap-5 items-center">
              <TouchableOpacity onPress={handleImageSelect}><Ionicons name={attachment?.type === 'image' ? 'image' : 'image-outline'} size={24} color={attachment?.type === 'image' ? '#fff' : '#ff4500'} /></TouchableOpacity>
              <TouchableOpacity onPress={handleGifSelect}><View className={`border-2 rounded px-1.5 py-0.5 ${attachment?.type === 'gif' ? 'border-white bg-white/10' : 'border-[#ff4500]'}`}><Text className={`font-black text-[10px] ${attachment?.type === 'gif' ? 'text-white' : 'text-[#ff4500]'}`}>GIF</Text></View></TouchableOpacity>
              <TouchableOpacity onPress={handleVideoSelect}><Ionicons name={attachment?.type === 'video' ? 'videocam' : 'videocam-outline'} size={26} color={attachment?.type === 'video' ? '#fff' : '#ff4500'} /></TouchableOpacity>
              <TouchableOpacity onPress={handleDocumentSelect}><Ionicons name={attachment?.type === 'document' ? 'document-text' : 'document-text-outline'} size={24} color={attachment?.type === 'document' ? '#fff' : '#ff4500'} /></TouchableOpacity>
              <TouchableOpacity onPress={handleLinkToggle}><Ionicons name={showLinkInput ? 'link' : 'link-outline'} size={26} color={showLinkInput ? '#3b82f6' : '#ff4500'} /></TouchableOpacity>
              <TouchableOpacity onPress={handlePollToggle}><Ionicons name={showPollEditor ? 'bar-chart' : 'bar-chart-outline'} size={24} color={showPollEditor ? '#10b981' : '#ff4500'} /></TouchableOpacity>
            </View>
            <TouchableOpacity onPress={handleLocationToggle} disabled={isLoadingLocation}>{isLoadingLocation ? <ActivityIndicator size="small" color="#ff4500" /> : <Ionicons name={postLocation ? 'location' : 'location-outline'} size={26} color={postLocation ? '#10b981' : '#ff4500'} />}</TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===== COMENTÁRIOS FULLSCREEN (estilo X/Threads) ===== */}
      <Modal visible={!!commentModalPost} animationType="slide" transparent={false} onRequestClose={() => { setCommentModalPost(null); setComments([]); setNewComment(''); setReplyingTo(null); }}>
        <View className="flex-1 bg-[#1a1a1a]">
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 pt-14 pb-3 border-b border-zinc-800">
            <TouchableOpacity onPress={() => { setCommentModalPost(null); setComments([]); setNewComment(''); setReplyingTo(null); }}><Ionicons name="arrow-back" size={24} color="white" /></TouchableOpacity>
            <Text className="text-white font-bold text-lg">Discussão</Text>
            <View style={{ width: 24 }} />
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
            <FlatList
              data={threadedComments}
              keyExtractor={(item, idx) => item.comment.id || String(idx)}
              contentContainerStyle={{ paddingBottom: 16 }}
              ListHeaderComponent={() => commentModalPost ? (
                <View className="px-4 pt-5 pb-4 border-b border-zinc-800 mb-2">
                  {/* Post original */}
                  <View className="flex-row items-center mb-3">
                    <View className="w-10 h-10 bg-zinc-700 rounded-full items-center justify-center"><Text className="text-white font-bold text-lg">{commentModalPost.profiles?.full_name?.charAt(0)||'?'}</Text></View>
                    <View className="ml-3"><Text className="text-white font-bold text-base">{commentModalPost.profiles?.full_name}</Text><Text className="text-gray-500 text-xs">{formatTimeAgo(commentModalPost.created_at)}</Text></View>
                  </View>
                  {commentModalPost.content ? <Text className="text-gray-200 text-base leading-6 mb-3">{commentModalPost.content}</Text> : null}
                  {renderPostMedia(commentModalPost)}
                  {renderPostLink(commentModalPost)}
                  {renderPostPoll(commentModalPost)}
                  <View className="flex-row items-center mt-2 pt-3 border-t border-zinc-800">
                    <Text className="text-gray-500 text-sm">{commentModalPost.comment_count||0} comentários</Text>
                    <Text className="text-gray-600 mx-2">·</Text>
                    <Text className="text-gray-500 text-sm">{commentModalPost.apoiar_count||0} apoios</Text>
                  </View>
                </View>
              ) : null}
              ListEmptyComponent={() => !loadingComments ? (
                <View className="py-12 items-center">
                  <Ionicons name="chatbubble-outline" size={40} color="#3f3f46" />
                  <Text className="text-zinc-500 text-base mt-3">Nenhum comentário ainda</Text>
                  <Text className="text-zinc-600 text-sm mt-1">Seja o primeiro a comentar!</Text>
                </View>
              ) : <View className="py-12 items-center"><ActivityIndicator color="#ff4500" /></View>}
              renderItem={({ item: { comment: c, isReply, parentAuthor } }) => (
                <View className={`flex-row px-4 py-2 ${isReply ? 'ml-12' : ''}`}>
                  {/* Linha de conexão */}
                  {isReply && <View className="absolute left-[36px] top-0 bottom-0 w-[2px] bg-zinc-800" style={{ height: '100%' }} />}
                  <View className={`${isReply ? 'w-8 h-8' : 'w-10 h-10'} bg-zinc-700 rounded-full items-center justify-center mr-3`}>
                    <Text className={`text-white font-bold ${isReply ? 'text-xs' : 'text-sm'}`}>{c.profiles?.full_name?.charAt(0)||'?'}</Text>
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center">
                      <Text className="text-white font-bold text-sm mr-2">{c.profiles?.full_name}</Text>
                      <Text className="text-zinc-500 text-xs">{formatTimeAgo(c.created_at)}</Text>
                    </View>
                    {isReply && parentAuthor && (
                      <Text className="text-gray-500 text-xs mb-0.5">respondendo a <Text className="text-[#ff4500]">{parentAuthor}</Text></Text>
                    )}
                    <Text className="text-gray-300 text-sm leading-5 mt-1">{c.content}</Text>
                    {/* Botão responder */}
                    <TouchableOpacity onPress={() => { setReplyingTo(c); commentInputRef.current?.focus(); }} className="mt-2 mb-1">
                      <Text className="text-gray-500 text-xs font-medium">Responder</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />

            {/* Input fixo no fundo */}
            <View className="border-t border-zinc-800 bg-zinc-900">
              {replyingTo && (
                <View className="flex-row items-center px-4 pt-2">
                  <Text className="text-gray-500 text-xs flex-1">Respondendo a <Text className="text-[#ff4500] font-bold">{replyingTo.profiles?.full_name}</Text></Text>
                  <TouchableOpacity onPress={() => setReplyingTo(null)}><Ionicons name="close-circle" size={16} color="#6b7280" /></TouchableOpacity>
                </View>
              )}
              <View className="flex-row items-center px-4 py-3 pb-8">
                <View className="w-9 h-9 bg-zinc-700 rounded-full items-center justify-center mr-3"><Text className="text-white font-bold text-sm">{currentUser?.profile?.full_name?.charAt(0)||'?'}</Text></View>
                <View className="flex-1 bg-zinc-800 rounded-2xl flex-row items-center px-4 py-2 border border-zinc-700">
                  <TextInput ref={commentInputRef} className="flex-1 text-white text-sm" placeholder={replyingTo ? `Responder ${replyingTo.profiles?.full_name}...` : 'Comentar...'} placeholderTextColor="#6b7280" value={newComment} onChangeText={setNewComment} multiline style={{ maxHeight: 80 }} />
                </View>
                <TouchableOpacity onPress={sendComment} disabled={!newComment.trim() || sendingComment} className="ml-3">
                  {sendingComment ? <ActivityIndicator size="small" color="#ff4500" /> : <Ionicons name="send" size={24} color={newComment.trim() ? '#ff4500' : '#6b7280'} />}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ===== STORIES FULLSCREEN ===== */}
      <Modal visible={activeGroupIdx !== null} animationType="fade" transparent={false} onRequestClose={closeStories} statusBarTranslucent>
        <View className="flex-1 bg-black" {...storyPan.panHandlers}>
          {activeGroup && activeStory && (
            <>
              {/* Barras de progresso — descer do topo para não ativar notification bar */}
              <SafeAreaView>
                <View className="flex-row px-3 mt-2 gap-1">
                  {activeGroup.stories.map((_: any, idx: number) => (
                    <View key={idx} className="h-[3px] flex-1 bg-zinc-700 rounded-full overflow-hidden">
                      {idx < activeStoryIdx ? <View className="h-full w-full bg-white rounded-full" /> :
                       idx === activeStoryIdx ? <Animated.View style={{ height: '100%', backgroundColor: '#fff', borderRadius: 999, width: progress.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] }) }} /> : null}
                    </View>
                  ))}
                </View>

                {/* Header — dentro do SafeAreaView */}
                <View className="flex-row items-center justify-between px-4 mt-3">
                  <View className="flex-row items-center">
                    <View className={`w-10 h-10 rounded-full border-2 items-center justify-center ${activeGroup.isGlobal ? 'border-red-500 bg-red-900/50' : 'border-[#ff4500] bg-zinc-800'}`}>
                      {activeGroup.isGlobal ? <Ionicons name="megaphone" size={18} color="white" /> : <Text className="text-white font-bold">{activeGroup.sourceName.charAt(0)}</Text>}
                    </View>
                    <View className="ml-3"><Text className="text-white font-bold text-base">{activeGroup.sourceName}</Text><Text className="text-gray-400 text-xs">{activeStoryIdx+1} de {activeGroup.stories.length}</Text></View>
                  </View>
                  <TouchableOpacity onPress={closeStories} className="p-2"><Ionicons name="close" size={28} color="white" /></TouchableOpacity>
                </View>
              </SafeAreaView>

              {/* Conteúdo do story */}
              <View className="flex-1 justify-center px-6">
                <Text className="text-white text-3xl font-black text-center leading-[42px]">{activeStory.content}</Text>
                {activeStory.poll_options && Array.isArray(activeStory.poll_options) && activeStory.poll_options.length > 0 && (
                  <View className="mt-10 w-full">
                    <Text className="text-zinc-400 text-center mb-4 uppercase text-xs font-bold tracking-widest">Enquete</Text>
                    {activeStory.poll_options.map((opt: any, i: number) => <TouchableOpacity key={i} className="bg-zinc-800/80 py-4 px-6 rounded-2xl mb-3 border border-zinc-700 active:bg-[#ff4500]/30"><Text className="text-white text-center font-bold text-lg">{typeof opt === 'string' ? opt : opt.text}</Text></TouchableOpacity>)}
                  </View>
                )}
                {activeGroup.isGlobal && <View className="mt-16 items-center w-full"><TouchableOpacity className="bg-[#ff4500] py-4 w-full rounded-2xl flex-row items-center justify-center shadow-lg"><Ionicons name="location-sharp" size={22} color="white" /><Text className="text-white font-black text-base uppercase tracking-widest ml-2">Apoiar no Radar</Text></TouchableOpacity></View>}
              </View>

              {/* Indicador de pausa */}
              {paused && <View className="absolute top-1/2 left-0 right-0 items-center" style={{ marginTop: -20 }}><View className="bg-black/60 px-4 py-2 rounded-full flex-row items-center"><Ionicons name="pause" size={16} color="white" /><Text className="text-white text-sm font-medium ml-2">Pausado</Text></View></View>}

              {/* Dica de swipe (só nos primeiros usos) */}
              <View className="flex-row justify-center pb-8 gap-1.5">
                {storyGroups.map((_, i) => <View key={i} className={`w-1.5 h-1.5 rounded-full ${i === activeGroupIdx ? 'bg-white' : 'bg-zinc-600'}`} />)}
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* ===== BOTTOM SHEET MÍDIA ===== */}
      <Modal visible={mediaPickerVisible} transparent animationType="none" onRequestClose={closeMediaPicker} statusBarTranslucent>
        <Pressable onPress={closeMediaPicker} className="flex-1 bg-black/60 justify-end">
          <Animated.View style={{ transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0,1], outputRange: [300,0] }) }] }}>
            <Pressable onPress={() => {}}>
              <View className="bg-zinc-900 rounded-t-3xl pt-4 pb-10 px-6 border-t border-zinc-700">
                <View className="w-10 h-1 bg-zinc-600 rounded-full self-center mb-6" />
                <Text className="text-white font-bold text-lg mb-5">{mediaPickerType === 'image' ? 'Adicionar Imagem' : 'Adicionar Vídeo'}</Text>
                <TouchableOpacity onPress={() => { closeMediaPicker(); setTimeout(() => mediaPickerType === 'image' ? pickImage('camera') : pickVideo('camera'), 300); }} className="flex-row items-center py-4 border-b border-zinc-800" activeOpacity={0.7}>
                  <View className="w-12 h-12 bg-[#ff4500]/15 rounded-2xl items-center justify-center mr-4"><Ionicons name="camera" size={24} color="#ff4500" /></View>
                  <View className="flex-1"><Text className="text-white font-bold text-base">{mediaPickerType === 'image' ? 'Tirar Foto' : 'Gravar Vídeo'}</Text><Text className="text-gray-500 text-sm mt-0.5">Câmera do dispositivo</Text></View>
                  <Ionicons name="chevron-forward" size={20} color="#6b7280" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { closeMediaPicker(); setTimeout(() => mediaPickerType === 'image' ? pickImage('gallery') : pickVideo('gallery'), 300); }} className="flex-row items-center py-4" activeOpacity={0.7}>
                  <View className="w-12 h-12 bg-blue-500/15 rounded-2xl items-center justify-center mr-4"><Ionicons name="images" size={24} color="#3b82f6" /></View>
                  <View className="flex-1"><Text className="text-white font-bold text-base">Escolher da Galeria</Text><Text className="text-gray-500 text-sm mt-0.5">{mediaPickerType === 'image' ? 'Foto existente' : 'Vídeo existente'}</Text></View>
                  <Ionicons name="chevron-forward" size={20} color="#6b7280" />
                </TouchableOpacity>
                <TouchableOpacity onPress={closeMediaPicker} className="mt-4 py-3.5 bg-zinc-800 rounded-2xl items-center" activeOpacity={0.7}><Text className="text-gray-400 font-bold text-base">Cancelar</Text></TouchableOpacity>
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* ===== MEDIA VIEWER ===== */}
      <Modal visible={!!mediaViewer} transparent animationType="fade" onRequestClose={() => setMediaViewer(null)} statusBarTranslucent>
        <View className="flex-1 bg-black">
          <StatusBar barStyle="light-content" backgroundColor="black" />
          <View className="absolute top-0 left-0 right-0 z-10 flex-row justify-between items-center pt-14 px-4 pb-3">
            <TouchableOpacity onPress={() => setMediaViewer(null)} className="w-10 h-10 bg-black/50 rounded-full items-center justify-center"><Ionicons name="close" size={24} color="white" /></TouchableOpacity>
            {mediaViewer?.type === 'gif' && <View className="bg-white/20 px-3 py-1 rounded-full"><Text className="text-white text-xs font-bold">GIF</Text></View>}
          </View>
          {mediaViewer?.type === 'video' ? <View className="flex-1 justify-center"><Video source={{ uri: mediaViewer.url }} style={{ width: SW, height: SH * 0.7 }} resizeMode={ResizeMode.CONTAIN} shouldPlay isLooping useNativeControls isMuted={false} /></View>
          : <View className="flex-1 justify-center items-center"><Image source={{ uri: mediaViewer?.url }} style={{ width: SW, height: SH * 0.8 }} resizeMode="contain" /></View>}
        </View>
      </Modal>

    </View>
  );
}
