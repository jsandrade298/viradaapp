import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, ScrollView,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Image, Linking,
  Dimensions, StatusBar, Animated, Pressable
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { Video, ResizeMode } from 'expo-av';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';

// =======================
// TIPOS
// =======================
type AttachmentType = 'image' | 'video' | 'gif' | 'document' | null;
interface PostAttachment { uri: string; type: AttachmentType; mimeType?: string; fileName?: string; }
interface PostLocation { name: string; latitude: number; longitude: number; }
interface PollOption { text: string; votes: number; }

interface StoryGroup {
  sourceId: string; // community_id ou 'global'
  sourceName: string;
  isGlobal: boolean;
  stories: any[];
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORY_DURATION = 6000; // 6 segundos por story

// =======================
// COMPONENTE PRINCIPAL
// =======================
export default function FeedScreen() {
  // --- FEED ---
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // --- STORIES ---
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [activeGroupIndex, setActiveGroupIndex] = useState<number | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const storyProgress = useRef(new Animated.Value(0)).current;
  const storyTimer = useRef<any>(null);
  const [viewedGroups, setViewedGroups] = useState<Set<string>>(new Set());
  const [isStoryPaused, setIsStoryPaused] = useState(false);
  const pausedProgress = useRef(0);

  // --- POST MODAL ---
  const [isPostModalVisible, setIsPostModalVisible] = useState(false);
  const [newPostContent, setNewPostContent] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // --- ANEXOS ---
  const [attachment, setAttachment] = useState<PostAttachment | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>([]);
  const [showPollEditor, setShowPollEditor] = useState(false);
  const [postLocation, setPostLocation] = useState<PostLocation | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);

  // --- INTERAÇÕES ---
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});
  const [userInteractions, setUserInteractions] = useState<Record<string, string[]>>({});

  // --- BOTTOM SHEET ---
  const [mediaPickerVisible, setMediaPickerVisible] = useState(false);
  const [mediaPickerType, setMediaPickerType] = useState<'image' | 'video'>('image');
  const sheetAnim = useRef(new Animated.Value(0)).current;

  // --- MEDIA VIEWER ---
  const [mediaViewer, setMediaViewer] = useState<{ url: string; type: string } | null>(null);

  useEffect(() => {
    fetchCurrentUser();
    fetchFeed();
  }, []);

  async function fetchCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles').select('full_name, avatar_url').eq('id', user.id).single();
      setCurrentUser({ ...user, profile });
    }
  }

  // =======================
  // BUSCAR FEED
  // =======================
  async function fetchFeed() {
    // --- STORIES: buscar e agrupar por comunidade ---
    const { data: allAnnouncements } = await supabase
      .from('announcements')
      .select('*, communities(id, name)')
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (allAnnouncements) {
      const groups: Record<string, StoryGroup> = {};

      // Grupo global (megafone) primeiro
      const globals = allAnnouncements.filter(a => a.is_global);
      if (globals.length > 0) {
        groups['global'] = {
          sourceId: 'global',
          sourceName: 'Coordenação',
          isGlobal: true,
          stories: globals,
        };
      }

      // Grupos por comunidade
      allAnnouncements.filter(a => !a.is_global && a.community_id).forEach(a => {
        const cid = a.community_id;
        if (!groups[cid]) {
          groups[cid] = {
            sourceId: cid,
            sourceName: a.communities?.name || 'Comunidade',
            isGlobal: false,
            stories: [],
          };
        }
        groups[cid].stories.push(a);
      });

      // Global primeiro, depois as comunidades
      const ordered = [];
      if (groups['global']) ordered.push(groups['global']);
      Object.keys(groups).filter(k => k !== 'global').forEach(k => ordered.push(groups[k]));
      setStoryGroups(ordered);
    }

    // --- POSTS com contagens reais ---
    const { data: feedPosts } = await supabase
      .from('posts')
      .select(`id, content, media_url, media_type, link_url, poll_options, 
               location_name, latitude, longitude, created_at, author_id,
               profiles (full_name, avatar_url), communities (name),
               comments (count),
               post_interactions (count)`)
      .order('created_at', { ascending: false });

    if (feedPosts && feedPosts.length > 0) {
      // Buscar contagens por tipo de interação
      const postIds = feedPosts.map(p => p.id);
      const { data: interactions } = await supabase
        .from('post_interactions')
        .select('post_id, interaction_type, user_id')
        .in('post_id', postIds);

      // Montar mapa de contagens
      const countsMap: Record<string, { APOIAR: number; REPERCUTIR: number; SALVAR: number }> = {};
      const userInts: Record<string, string[]> = {};

      postIds.forEach(id => {
        countsMap[id] = { APOIAR: 0, REPERCUTIR: 0, SALVAR: 0 };
      });

      if (interactions) {
        interactions.forEach(i => {
          if (countsMap[i.post_id]) {
            countsMap[i.post_id][i.interaction_type as keyof typeof countsMap[string]]++;
          }
          // Registrar interações do user atual
          if (currentUser && i.user_id === currentUser.id) {
            if (!userInts[i.post_id]) userInts[i.post_id] = [];
            userInts[i.post_id].push(i.interaction_type);
          }
        });
      }

      // Enriquecer posts com contagens
      const enriched = feedPosts.map(p => ({
        ...p,
        apoiar_count: countsMap[p.id]?.APOIAR || 0,
        repercutir_count: countsMap[p.id]?.REPERCUTIR || 0,
        salvar_count: countsMap[p.id]?.SALVAR || 0,
        comment_count: Array.isArray(p.comments) ? p.comments.length : (p.comments as any)?.[0]?.count || 0,
      }));

      setPosts(enriched);
      setUserInteractions(userInts);
    }

    setLoading(false);
  }

  // =======================
  // INTERAÇÕES REAIS
  // =======================
  async function toggleInteraction(postId: string, type: 'APOIAR' | 'REPERCUTIR' | 'SALVAR') {
    if (!currentUser) return;

    const currentInts = userInteractions[postId] || [];
    const hasIt = currentInts.includes(type);

    if (hasIt) {
      // Remover interação
      await supabase.from('post_interactions')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', currentUser.id)
        .eq('interaction_type', type);

      setUserInteractions(prev => ({
        ...prev,
        [postId]: (prev[postId] || []).filter(t => t !== type),
      }));

      setPosts(prev => prev.map(p => p.id === postId ? {
        ...p,
        [`${type.toLowerCase()}_count`]: Math.max(0, p[`${type.toLowerCase()}_count`] - 1),
      } : p));
    } else {
      // Adicionar interação
      await supabase.from('post_interactions').insert({
        post_id: postId,
        user_id: currentUser.id,
        interaction_type: type,
      });

      setUserInteractions(prev => ({
        ...prev,
        [postId]: [...(prev[postId] || []), type],
      }));

      setPosts(prev => prev.map(p => p.id === postId ? {
        ...p,
        [`${type.toLowerCase()}_count`]: p[`${type.toLowerCase()}_count`] + 1,
      } : p));
    }
  }

  function hasInteraction(postId: string, type: string): boolean {
    return (userInteractions[postId] || []).includes(type);
  }

  // =======================
  // STORIES: NAVEGAÇÃO
  // =======================
  function openStoryGroup(groupIndex: number) {
    setActiveGroupIndex(groupIndex);
    setActiveStoryIndex(0);
    setIsStoryPaused(false);
    pausedProgress.current = 0;
    // Marcar como visto (exceto global)
    const group = storyGroups[groupIndex];
    if (!group.isGlobal) {
      setViewedGroups(prev => new Set([...prev, group.sourceId]));
    }
    startStoryTimer(0);
  }

  function startStoryTimer(_index: number, fromProgress: number = 0) {
    storyProgress.setValue(fromProgress);
    if (storyTimer.current) clearTimeout(storyTimer.current);
    
    const remainingDuration = STORY_DURATION * (1 - fromProgress);

    Animated.timing(storyProgress, {
      toValue: 1,
      duration: remainingDuration,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) goToNextStory();
    });
  }

  function pauseStory() {
    setIsStoryPaused(true);
    storyProgress.stopAnimation((value) => {
      pausedProgress.current = value;
    });
  }

  function resumeStory() {
    setIsStoryPaused(false);
    startStoryTimer(activeStoryIndex, pausedProgress.current);
  }

  function goToNextStory() {
    if (activeGroupIndex === null) return;
    const group = storyGroups[activeGroupIndex];
    
    if (activeStoryIndex < group.stories.length - 1) {
      const next = activeStoryIndex + 1;
      setActiveStoryIndex(next);
      pausedProgress.current = 0;
      startStoryTimer(next);
    } else if (activeGroupIndex < storyGroups.length - 1) {
      const nextGroup = activeGroupIndex + 1;
      setActiveGroupIndex(nextGroup);
      setActiveStoryIndex(0);
      pausedProgress.current = 0;
      // Marcar próximo grupo como visto (exceto global)
      if (!storyGroups[nextGroup].isGlobal) {
        setViewedGroups(prev => new Set([...prev, storyGroups[nextGroup].sourceId]));
      }
      startStoryTimer(0);
    } else {
      closeStories();
    }
  }

  function goToPrevStory() {
    if (activeGroupIndex === null) return;
    
    if (activeStoryIndex > 0) {
      const prev = activeStoryIndex - 1;
      setActiveStoryIndex(prev);
      pausedProgress.current = 0;
      startStoryTimer(prev);
    } else if (activeGroupIndex > 0) {
      const prevGroup = activeGroupIndex - 1;
      const prevGroupStories = storyGroups[prevGroup].stories;
      setActiveGroupIndex(prevGroup);
      setActiveStoryIndex(prevGroupStories.length - 1);
      pausedProgress.current = 0;
      startStoryTimer(prevGroupStories.length - 1);
    }
  }

  function closeStories() {
    storyProgress.stopAnimation();
    if (storyTimer.current) clearTimeout(storyTimer.current);
    setActiveGroupIndex(null);
    setActiveStoryIndex(0);
    setIsStoryPaused(false);
    pausedProgress.current = 0;
  }

  // =======================
  // RESET POST MODAL
  // =======================
  function resetPostModal() {
    setNewPostContent('');
    setAttachment(null);
    setLinkUrl('');
    setShowLinkInput(false);
    setPollOptions([]);
    setShowPollEditor(false);
    setPostLocation(null);
    setIsPostModalVisible(false);
  }

  // =======================
  // BOTTOM SHEET DE MÍDIA
  // =======================
  function openMediaPicker(type: 'image' | 'video') {
    if (attachment) setAttachment(null);
    setMediaPickerType(type);
    setMediaPickerVisible(true);
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }

  function closeMediaPicker() {
    Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setMediaPickerVisible(false));
  }

  // =======================
  // SELEÇÃO DE MÍDIA
  // =======================
  function handleImageSelect() { openMediaPicker('image'); }
  function handleVideoSelect() { openMediaPicker('video'); }
  function handleGifSelect() { if (attachment) setAttachment(null); pickGif(); }
  function handleDocumentSelect() { if (attachment) setAttachment(null); pickDocument(); }

  async function pickImage(source: 'camera' | 'gallery') {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permissão negada", "Precisamos de acesso à câmera."); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, allowsEditing: true, quality: 0.7 });
      if (!result.canceled) setAttachment({ uri: result.assets[0].uri, type: 'image', mimeType: 'image/jpeg' });
    } else {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, allowsEditing: true, quality: 0.7 });
      if (!result.canceled) {
        const asset = result.assets[0];
        setAttachment({ uri: asset.uri, type: 'image', mimeType: asset.mimeType || 'image/jpeg' });
      }
    }
  }

  async function pickGif() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 1 });
    if (!result.canceled) setAttachment({ uri: result.assets[0].uri, type: 'gif', mimeType: 'image/gif' });
  }

  async function pickVideo(source: 'camera' | 'gallery') {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permissão negada", "Precisamos de acesso à câmera."); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'] as any, allowsEditing: true, videoMaxDuration: 120, quality: 0.7 });
      if (!result.canceled) setAttachment({ uri: result.assets[0].uri, type: 'video', mimeType: result.assets[0].mimeType || 'video/mp4' });
    } else {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] as any, allowsEditing: true, videoMaxDuration: 120, quality: 0.7 });
      if (!result.canceled) setAttachment({ uri: result.assets[0].uri, type: 'video', mimeType: result.assets[0].mimeType || 'video/mp4' });
    }
  }

  async function pickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const doc = result.assets[0];
        setAttachment({ uri: doc.uri, type: 'document', mimeType: doc.mimeType || 'application/octet-stream', fileName: doc.name });
      }
    } catch (err) { Alert.alert("Erro", "Não foi possível selecionar o documento."); }
  }

  // =======================
  // LINK / ENQUETE / LOCALIZAÇÃO
  // =======================
  function handleLinkToggle() {
    if (showLinkInput) { setShowLinkInput(false); setLinkUrl(''); } else { setShowLinkInput(true); }
  }

  function handlePollToggle() {
    if (showPollEditor) { setShowPollEditor(false); setPollOptions([]); }
    else { setShowPollEditor(true); if (pollOptions.length === 0) setPollOptions(['', '']); }
  }

  function updatePollOption(index: number, text: string) {
    const updated = [...pollOptions]; updated[index] = text; setPollOptions(updated);
  }

  function addPollOption() {
    if (pollOptions.length < 5) setPollOptions([...pollOptions, '']);
    else Alert.alert("Limite", "Máximo de 5 opções.");
  }

  function removePollOption(index: number) {
    if (pollOptions.length <= 2) { Alert.alert("Mínimo", "Pelo menos 2 opções."); return; }
    setPollOptions(pollOptions.filter((_, i) => i !== index));
  }

  async function handleLocationToggle() {
    if (postLocation) { setPostLocation(null); return; }
    setIsLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert("Permissão negada"); setIsLoadingLocation(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [address] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      let locationName = 'Localização atual';
      if (address) {
        const parts = [address.street, address.district, address.city].filter(Boolean);
        locationName = parts.join(', ') || address.name || locationName;
      }
      setPostLocation({ name: locationName, latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    } catch (err) { Alert.alert("Erro", "Não foi possível obter localização."); }
    setIsLoadingLocation(false);
  }

  // =======================
  // UPLOAD + CRIAR POST
  // =======================
  async function uploadMedia(userId: string): Promise<{ url: string; type: string } | null> {
    if (!attachment) return null;
    const ext = attachment.type === 'video' ? 'mp4' : attachment.type === 'gif' ? 'gif' : attachment.type === 'document' ? (attachment.fileName?.split('.').pop() || 'pdf') : 'jpg';
    const contentType = attachment.mimeType || (attachment.type === 'video' ? 'video/mp4' : attachment.type === 'gif' ? 'image/gif' : attachment.type === 'document' ? 'application/octet-stream' : 'image/jpeg');
    const fileName = `${userId}/${Date.now()}.${ext}`;
    const base64Data = await FileSystem.readAsStringAsync(attachment.uri, { encoding: 'base64' });
    const arrayBuffer = decode(base64Data);
    const { error: uploadError } = await supabase.storage.from('post_media').upload(fileName, arrayBuffer, { contentType, upsert: false });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('post_media').getPublicUrl(fileName);
    return { url: publicUrl, type: attachment.type || 'image' };
  }

  function canPublish(): boolean {
    return newPostContent.trim().length > 0 || !!attachment || (showLinkInput && linkUrl.trim().length > 0) || (showPollEditor && pollOptions.filter(o => o.trim()).length >= 2);
  }

  async function handleCreatePost() {
    if (!canPublish()) return;
    if (showPollEditor && pollOptions.filter(o => o.trim()).length < 2) { Alert.alert("Enquete incompleta", "Preencha pelo menos 2 opções."); return; }
    if (showLinkInput && linkUrl.trim() && !/^https?:\/\//i.test(linkUrl.trim())) { Alert.alert("Link inválido", "Deve começar com http:// ou https://"); return; }
    setIsPublishing(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert("Erro de Autenticação"); setIsPublishing(false); return; }
    let mediaUrl: string | null = null, mediaType: string | null = null;
    if (attachment) {
      try {
        const uploaded = await uploadMedia(user.id);
        if (uploaded) { mediaUrl = uploaded.url; mediaType = uploaded.type; }
      } catch (err) { Alert.alert("Erro no Upload", "Verifique a conexão."); setIsPublishing(false); return; }
    }
    let finalPollOptions: any = null;
    if (showPollEditor) {
      const valid = pollOptions.filter(o => o.trim());
      if (valid.length >= 2) finalPollOptions = valid.map(text => ({ text: text.trim(), votes: 0 }));
    }
    const { error } = await supabase.from('posts').insert({
      author_id: user.id,
      content: newPostContent.trim() || null,
      media_url: mediaUrl, media_type: mediaType,
      link_url: (showLinkInput && linkUrl.trim()) ? linkUrl.trim() : null,
      poll_options: finalPollOptions,
      location_name: postLocation?.name || null,
      latitude: postLocation?.latitude || null,
      longitude: postLocation?.longitude || null,
    });
    setIsPublishing(false);
    if (error) { Alert.alert("Erro ao publicar"); console.error(error); }
    else { resetPostModal(); fetchFeed(); }
  }

  // =======================
  // ENQUETE: VOTAR
  // =======================
  async function handlePollVote(postId: string, optionIndex: number, currentOptions: PollOption[]) {
    if (userVotes[postId] !== undefined) return;
    const updated = currentOptions.map((opt, i) => ({ ...opt, votes: i === optionIndex ? opt.votes + 1 : opt.votes }));
    const { error } = await supabase.from('posts').update({ poll_options: updated }).eq('id', postId);
    if (!error) { setUserVotes(prev => ({ ...prev, [postId]: optionIndex })); fetchFeed(); }
  }

  // =======================
  // HELPERS
  // =======================
  function getDocIcon(fileName?: string): string {
    const ext = fileName?.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'document-text';
    if (['doc', 'docx'].includes(ext || '')) return 'document';
    if (['xls', 'xlsx'].includes(ext || '')) return 'grid';
    return 'document-text-outline';
  }

  function formatTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  // =======================
  // RENDER: MÍDIA DO POST
  // =======================
  function renderPostMedia(item: any) {
    if (item.media_url && item.media_type === 'image') {
      return (
        <TouchableOpacity activeOpacity={0.9} onPress={() => setMediaViewer({ url: item.media_url, type: 'image' })}>
          <Image source={{ uri: item.media_url }} className="w-full h-52 rounded-xl mb-4" resizeMode="cover" />
        </TouchableOpacity>
      );
    }
    if (item.media_url && item.media_type === 'gif') {
      return (
        <TouchableOpacity activeOpacity={0.9} onPress={() => setMediaViewer({ url: item.media_url, type: 'gif' })} className="mb-4">
          <Image source={{ uri: item.media_url }} className="w-full h-52 rounded-xl" resizeMode="cover" />
          <View className="absolute top-2 left-2 bg-black/60 px-2 py-0.5 rounded">
            <Text className="text-white text-xs font-bold">GIF</Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.media_url && item.media_type === 'video') {
      return (
        <TouchableOpacity activeOpacity={0.9} onPress={() => setMediaViewer({ url: item.media_url, type: 'video' })} className="mb-4">
          <View className="w-full h-52 rounded-xl bg-zinc-800 overflow-hidden">
            <Video source={{ uri: item.media_url }} style={{ width: '100%', height: '100%' }} resizeMode={ResizeMode.COVER} shouldPlay={true} isLooping={true} isMuted={true} />
            <View className="absolute bottom-2 right-2 flex-row items-center">
              <View className="bg-black/60 p-1.5 rounded-full mr-1.5"><Ionicons name="volume-mute" size={14} color="white" /></View>
              <View className="bg-black/60 p-1.5 rounded-full"><Ionicons name="expand" size={14} color="white" /></View>
            </View>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.media_url && item.media_type === 'document') {
      const fileName = decodeURIComponent(item.media_url.split('/').pop() || 'Documento');
      return (
        <TouchableOpacity onPress={() => Linking.openURL(item.media_url)} className="bg-zinc-800 rounded-xl p-4 mb-4 flex-row items-center border border-zinc-700">
          <View className="w-12 h-12 bg-[#ff4500]/20 rounded-xl items-center justify-center mr-4">
            <Ionicons name={getDocIcon(fileName) as any} size={24} color="#ff4500" />
          </View>
          <View className="flex-1">
            <Text className="text-white font-bold text-sm" numberOfLines={1}>{fileName}</Text>
            <Text className="text-gray-400 text-xs mt-0.5">Toque para abrir</Text>
          </View>
          <Ionicons name="download-outline" size={22} color="#9ca3af" />
        </TouchableOpacity>
      );
    }
    return null;
  }

  function renderPostLink(item: any) {
    if (!item.link_url) return null;
    return (
      <TouchableOpacity onPress={() => Linking.openURL(item.link_url)} className="bg-zinc-800 rounded-xl p-4 mb-4 flex-row items-center border border-zinc-700">
        <View className="w-10 h-10 bg-blue-500/20 rounded-lg items-center justify-center mr-3"><Ionicons name="link" size={20} color="#3b82f6" /></View>
        <View className="flex-1"><Text className="text-blue-400 text-sm font-medium" numberOfLines={2}>{item.link_url}</Text></View>
        <Ionicons name="open-outline" size={18} color="#3b82f6" />
      </TouchableOpacity>
    );
  }

  // =======================
  // RENDER: ENQUETE (CORRIGIDA)
  // =======================
  function renderPostPoll(item: any) {
    if (!item.poll_options || !Array.isArray(item.poll_options)) return null;
    const options: PollOption[] = item.poll_options;
    const totalVotes = options.reduce((sum, o) => sum + (o.votes || 0), 0);
    const hasVoted = userVotes[item.id] !== undefined;

    return (
      <View className="mb-4">
        {options.map((option, index) => {
          const percentage = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
          const isSelected = userVotes[item.id] === index;

          return (
            <TouchableOpacity
              key={index}
              onPress={() => handlePollVote(item.id, index, options)}
              disabled={hasVoted}
              activeOpacity={hasVoted ? 1 : 0.7}
              className={`mb-2.5 rounded-xl overflow-hidden border ${isSelected ? 'border-[#ff4500]' : 'border-zinc-700'}`}
            >
              <View style={{ height: 48, justifyContent: 'center' }}>
                {/* Barra de progresso com largura em pixels */}
                {hasVoted && (
                  <View
                    style={{
                      position: 'absolute', top: 0, left: 0, bottom: 0,
                      width: (SCREEN_WIDTH - 74) * (percentage / 100), // 74 = padding + borders
                      backgroundColor: isSelected ? 'rgba(255, 69, 0, 0.2)' : 'rgba(63, 63, 70, 0.8)',
                      borderRadius: 12,
                    }}
                  />
                )}
                <View className="flex-row justify-between items-center px-4" style={{ zIndex: 1 }}>
                  <View className="flex-row items-center flex-1">
                    {hasVoted && (
                      <View className={`w-5 h-5 rounded-full mr-2.5 items-center justify-center ${isSelected ? 'bg-[#ff4500]' : 'bg-zinc-600'}`}>
                        {isSelected && <Ionicons name="checkmark" size={12} color="white" />}
                      </View>
                    )}
                    <Text className={`text-sm font-medium flex-1 ${isSelected ? 'text-white' : 'text-gray-200'}`}>
                      {option.text}
                    </Text>
                  </View>
                  {hasVoted && (
                    <Text className={`text-sm font-bold ml-3 ${isSelected ? 'text-[#ff4500]' : 'text-gray-400'}`}>
                      {percentage}%
                    </Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
        <Text className="text-gray-500 text-xs mt-1 ml-1">
          {totalVotes} {totalVotes === 1 ? 'voto' : 'votos'}
          {hasVoted ? ' · Você votou' : ' · Toque para votar'}
        </Text>
      </View>
    );
  }

  function renderPostLocation(item: any) {
    if (!item.location_name) return null;
    return (
      <View className="flex-row items-center mb-3 mt-1">
        <Ionicons name="location" size={14} color="#ff4500" />
        <Text className="text-gray-400 text-xs ml-1">{item.location_name}</Text>
      </View>
    );
  }

  function renderAttachmentPreview() {
    if (!attachment) return null;
    return (
      <View className="mt-4 relative mb-4">
        {attachment.type === 'image' || attachment.type === 'gif' ? (
          <Image source={{ uri: attachment.uri }} className="w-full h-48 rounded-xl" resizeMode="cover" />
        ) : attachment.type === 'video' ? (
          <View className="w-full h-48 rounded-xl bg-zinc-800 items-center justify-center">
            <Ionicons name="videocam" size={40} color="#ff4500" />
            <Text className="text-gray-400 text-sm mt-2">Vídeo selecionado</Text>
          </View>
        ) : attachment.type === 'document' ? (
          <View className="w-full rounded-xl bg-zinc-800 p-4 flex-row items-center border border-zinc-700">
            <View className="w-12 h-12 bg-[#ff4500]/20 rounded-xl items-center justify-center mr-3">
              <Ionicons name={getDocIcon(attachment.fileName) as any} size={24} color="#ff4500" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-bold text-sm" numberOfLines={1}>{attachment.fileName || 'Documento'}</Text>
              <Text className="text-gray-400 text-xs mt-0.5">{attachment.mimeType}</Text>
            </View>
          </View>
        ) : null}
        {attachment.type === 'gif' && (
          <View className="absolute top-2 left-2 bg-black/70 px-2 py-0.5 rounded"><Text className="text-white text-xs font-bold">GIF</Text></View>
        )}
        <TouchableOpacity onPress={() => setAttachment(null)} className="absolute top-2 right-2 bg-black/70 p-1.5 rounded-full">
          <Ionicons name="close" size={20} color="white" />
        </TouchableOpacity>
      </View>
    );
  }

  // =======================
  // LOADING
  // =======================
  if (loading) {
    return <View className="flex-1 bg-[#1a1a1a] justify-center items-center"><ActivityIndicator size="large" color="#ff4500" /></View>;
  }

  // =======================
  // RENDER PRINCIPAL
  // =======================
  const activeGroup = activeGroupIndex !== null ? storyGroups[activeGroupIndex] : null;
  const activeStory = activeGroup?.stories[activeStoryIndex] || null;

  return (
    <View className="flex-1 bg-[#1a1a1a]">
      
      {/* HEADER */}
      <View className="pt-14 pb-4 px-6 flex-row justify-between items-center bg-[#1a1a1a] border-b border-zinc-800">
        <Text className="text-white text-2xl font-black tracking-wide">Mobiliza</Text>
        <View className="flex-row items-center">
          <TouchableOpacity className="mr-5 relative">
            <Ionicons name="notifications-outline" size={24} color="white" />
            <View className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#ff4500] rounded-full border border-[#1a1a1a]" />
          </TouchableOpacity>
          <TouchableOpacity><Ionicons name="chatbubbles-outline" size={24} color="white" /></TouchableOpacity>
        </View>
      </View>

      {/* FEED */}
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View className="mb-6">
            <Text className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-4 ml-1">Radar de Ações</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
              {storyGroups.map((group, idx) => {
                const isViewed = viewedGroups.has(group.sourceId) && !group.isGlobal;
                return (
                  <TouchableOpacity key={group.sourceId} onPress={() => openStoryGroup(idx)} className="items-center mr-5 ml-1" style={isViewed ? { opacity: 0.5 } : undefined}>
                    <View className={`${group.isGlobal ? 'w-[68px] h-[68px]' : 'w-16 h-16'} rounded-full border-2 ${group.isGlobal ? 'border-red-500' : isViewed ? 'border-zinc-600' : 'border-[#ff4500]'} p-[2px] items-center justify-center mb-1`}>
                      <View className={`flex-1 w-full h-full rounded-full ${group.isGlobal ? 'bg-red-900/80' : 'bg-zinc-800'} items-center justify-center`}>
                        {group.isGlobal ? (
                          <Ionicons name="megaphone" size={28} color="#ffffff" />
                        ) : (
                          <Text className="text-white font-bold text-xl">{group.sourceName.charAt(0)}</Text>
                        )}
                      </View>
                    </View>
                    {group.isGlobal && (
                      <View className="absolute bottom-4 bg-red-600 px-2 py-0.5 rounded border border-[#1a1a1a]">
                        <Text className="text-white text-[9px] font-black uppercase tracking-wider">Urgente</Text>
                      </View>
                    )}
                    <Text className={`${group.isGlobal ? 'text-red-400 font-bold' : isViewed ? 'text-zinc-500' : 'text-gray-300'} text-xs text-center w-16 mt-1`} numberOfLines={1}>
                      {group.sourceName}
                    </Text>
                    {group.stories.length > 1 && (
                      <Text className="text-zinc-500 text-[10px]">{group.stories.length} stories</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
        renderItem={({ item }) => (
          <View className="bg-zinc-900 rounded-xl p-5 mb-4 border border-zinc-800 shadow-sm">
            {/* Avatar + Info */}
            <View className="flex-row items-center mb-4">
              <View className="w-10 h-10 bg-zinc-700 rounded-full items-center justify-center">
                <Text className="text-white font-bold text-lg">{item.profiles?.full_name?.charAt(0) || '?'}</Text>
              </View>
              <View className="ml-3 flex-1">
                <View className="flex-row items-center">
                  <Text className="text-white font-bold text-base mr-2">{item.profiles?.full_name}</Text>
                  <Text className="text-gray-500 text-xs">{formatTimeAgo(item.created_at)}</Text>
                </View>
                <View className="flex-row items-center mt-0.5">
                  <Ionicons name="people" size={12} color="#9ca3af" />
                  <Text className="text-gray-400 text-xs ml-1 font-medium">{item.communities?.name || 'Feed Geral'}</Text>
                </View>
              </View>
            </View>
            
            {item.content ? <Text className="text-gray-200 text-base leading-6 mb-4">{item.content}</Text> : null}
            {renderPostLocation(item)}
            {renderPostMedia(item)}
            {renderPostLink(item)}
            {renderPostPoll(item)}

            {/* AÇÕES REAIS */}
            <View className="flex-row items-center justify-between border-t border-zinc-800 pt-4 px-1">
              <View className="flex-row items-center">
                {/* APOIAR */}
                <TouchableOpacity onPress={() => toggleInteraction(item.id, 'APOIAR')} className="flex-row items-center mr-7">
                  <Ionicons
                    name={hasInteraction(item.id, 'APOIAR') ? 'flame' : 'flame-outline'}
                    size={22}
                    color={hasInteraction(item.id, 'APOIAR') ? '#ff4500' : '#9ca3af'}
                  />
                  <Text className={`text-sm font-medium ml-1.5 ${hasInteraction(item.id, 'APOIAR') ? 'text-[#ff4500]' : 'text-gray-400'}`}>
                    {item.apoiar_count || 0}
                  </Text>
                </TouchableOpacity>

                {/* COMENTÁRIOS */}
                <TouchableOpacity className="flex-row items-center mr-7">
                  <Ionicons name="chatbubble-outline" size={20} color="#9ca3af" />
                  <Text className="text-gray-400 text-sm font-medium ml-1.5">{item.comment_count || 0}</Text>
                </TouchableOpacity>

                {/* REPERCUTIR */}
                <TouchableOpacity onPress={() => toggleInteraction(item.id, 'REPERCUTIR')} className="flex-row items-center">
                  <Ionicons
                    name={hasInteraction(item.id, 'REPERCUTIR') ? 'repeat' : 'repeat-outline'}
                    size={22}
                    color={hasInteraction(item.id, 'REPERCUTIR') ? '#10b981' : '#9ca3af'}
                  />
                  <Text className={`text-sm font-medium ml-1.5 ${hasInteraction(item.id, 'REPERCUTIR') ? 'text-emerald-500' : 'text-gray-400'}`}>
                    {item.repercutir_count || 0}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* SALVAR */}
              <TouchableOpacity onPress={() => toggleInteraction(item.id, 'SALVAR')}>
                <Ionicons
                  name={hasInteraction(item.id, 'SALVAR') ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={hasInteraction(item.id, 'SALVAR') ? '#f59e0b' : '#9ca3af'}
                />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* FAB */}
      <TouchableOpacity 
        onPress={() => setIsPostModalVisible(true)}
        className="absolute bottom-6 right-6 w-14 h-14 bg-[#ff4500] rounded-full items-center justify-center shadow-2xl elevation-5"
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={32} color="#ffffff" />
      </TouchableOpacity>

      {/* =============================== */}
      {/* MODAL DE NOVA POSTAGEM           */}
      {/* =============================== */}
      <Modal visible={isPostModalVisible} animationType="slide" transparent={false} onRequestClose={resetPostModal}
        onShow={() => { setTimeout(() => { inputRef.current?.focus(); }, 100); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-[#1a1a1a]">
          <View className="flex-row justify-between items-center px-4 pt-14 pb-4 border-b border-zinc-800">
            <TouchableOpacity onPress={resetPostModal}><Text className="text-gray-400 font-bold text-base">Cancelar</Text></TouchableOpacity>
            <TouchableOpacity onPress={handleCreatePost}
              className={`${canPublish() ? 'bg-[#ff4500]' : 'bg-zinc-700'} px-5 py-2 rounded-full min-w-[80px] items-center`}
              disabled={!canPublish() || isPublishing}>
              {isPublishing ? <ActivityIndicator size="small" color="#fff" /> : <Text className={`${canPublish() ? 'text-white' : 'text-gray-400'} font-bold text-sm`}>Publicar</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1 px-4 pt-5" keyboardShouldPersistTaps="handled">
            <View className="flex-row">
              <View className="w-10 h-10 bg-zinc-700 rounded-full items-center justify-center mr-3 mt-1">
                <Text className="text-white font-bold text-lg">{currentUser?.profile?.full_name?.charAt(0) || '?'}</Text>
              </View>
              <View className="flex-1">
                <TextInput ref={inputRef} className="text-white text-lg leading-7" placeholder="O que está organizando hoje?"
                  placeholderTextColor="#6b7280" multiline value={newPostContent} onChangeText={setNewPostContent}
                  style={{ textAlignVertical: 'top', minHeight: attachment || showPollEditor || showLinkInput ? 80 : 200 }} />
                {renderAttachmentPreview()}
                {postLocation && (
                  <View className="flex-row items-center bg-zinc-800 rounded-lg px-3 py-2 mb-4">
                    <Ionicons name="location" size={16} color="#ff4500" />
                    <Text className="text-gray-300 text-sm ml-2 flex-1" numberOfLines={1}>{postLocation.name}</Text>
                    <TouchableOpacity onPress={() => setPostLocation(null)}><Ionicons name="close-circle" size={18} color="#9ca3af" /></TouchableOpacity>
                  </View>
                )}
                {showLinkInput && (
                  <View className="mb-4">
                    <View className="flex-row items-center bg-zinc-800 rounded-xl px-3 py-2 border border-zinc-700">
                      <Ionicons name="link" size={18} color="#3b82f6" />
                      <TextInput className="text-blue-400 text-sm ml-2 flex-1" placeholder="https://..." placeholderTextColor="#6b7280"
                        value={linkUrl} onChangeText={setLinkUrl} autoCapitalize="none" keyboardType="url" />
                      <TouchableOpacity onPress={() => { setShowLinkInput(false); setLinkUrl(''); }}><Ionicons name="close-circle" size={18} color="#9ca3af" /></TouchableOpacity>
                    </View>
                  </View>
                )}
                {showPollEditor && (
                  <View className="mb-4 bg-zinc-800/50 rounded-xl p-4 border border-zinc-700">
                    <View className="flex-row justify-between items-center mb-3">
                      <Text className="text-white font-bold text-sm">Enquete</Text>
                      <TouchableOpacity onPress={() => { setShowPollEditor(false); setPollOptions([]); }}><Ionicons name="close-circle" size={20} color="#9ca3af" /></TouchableOpacity>
                    </View>
                    {pollOptions.map((option, index) => (
                      <View key={index} className="flex-row items-center mb-2">
                        <View className="flex-1 bg-zinc-900 rounded-lg px-3 py-2.5 border border-zinc-700 flex-row items-center">
                          <Text className="text-zinc-500 text-sm mr-2">{index + 1}.</Text>
                          <TextInput className="text-white text-sm flex-1" placeholder={`Opção ${index + 1}`} placeholderTextColor="#6b7280"
                            value={option} onChangeText={(t) => updatePollOption(index, t)} maxLength={80} />
                        </View>
                        {pollOptions.length > 2 && (
                          <TouchableOpacity onPress={() => removePollOption(index)} className="ml-2"><Ionicons name="trash-outline" size={18} color="#ef4444" /></TouchableOpacity>
                        )}
                      </View>
                    ))}
                    {pollOptions.length < 5 && (
                      <TouchableOpacity onPress={addPollOption} className="flex-row items-center justify-center py-2 mt-1">
                        <Ionicons name="add-circle-outline" size={18} color="#ff4500" />
                        <Text className="text-[#ff4500] text-sm font-medium ml-1">Adicionar opção</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          </ScrollView>

          {/* Toolbar */}
          <View className="flex-row items-center justify-between px-5 py-4 bg-zinc-900 border-t border-zinc-800 pb-8">
            <View className="flex-row gap-5 items-center">
              <TouchableOpacity onPress={handleImageSelect}><Ionicons name={attachment?.type === 'image' ? 'image' : 'image-outline'} size={24} color={attachment?.type === 'image' ? '#fff' : '#ff4500'} /></TouchableOpacity>
              <TouchableOpacity onPress={handleGifSelect}>
                <View className={`border-2 rounded px-1.5 py-0.5 ${attachment?.type === 'gif' ? 'border-white bg-white/10' : 'border-[#ff4500]'}`}>
                  <Text className={`font-black text-[10px] ${attachment?.type === 'gif' ? 'text-white' : 'text-[#ff4500]'}`}>GIF</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleVideoSelect}><Ionicons name={attachment?.type === 'video' ? 'videocam' : 'videocam-outline'} size={26} color={attachment?.type === 'video' ? '#fff' : '#ff4500'} /></TouchableOpacity>
              <TouchableOpacity onPress={handleDocumentSelect}><Ionicons name={attachment?.type === 'document' ? 'document-text' : 'document-text-outline'} size={24} color={attachment?.type === 'document' ? '#fff' : '#ff4500'} /></TouchableOpacity>
              <TouchableOpacity onPress={handleLinkToggle}><Ionicons name={showLinkInput ? 'link' : 'link-outline'} size={26} color={showLinkInput ? '#3b82f6' : '#ff4500'} /></TouchableOpacity>
              <TouchableOpacity onPress={handlePollToggle}><Ionicons name={showPollEditor ? 'bar-chart' : 'bar-chart-outline'} size={24} color={showPollEditor ? '#10b981' : '#ff4500'} /></TouchableOpacity>
            </View>
            <TouchableOpacity onPress={handleLocationToggle} disabled={isLoadingLocation}>
              {isLoadingLocation ? <ActivityIndicator size="small" color="#ff4500" /> : <Ionicons name={postLocation ? 'location' : 'location-outline'} size={26} color={postLocation ? '#10b981' : '#ff4500'} />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =============================== */}
      {/* STORIES INSTAGRAM-LIKE           */}
      {/* =============================== */}
      <Modal visible={activeGroupIndex !== null} animationType="fade" transparent={false} onRequestClose={closeStories} statusBarTranslucent>
        <View className="flex-1 bg-black">
          {activeGroup && activeStory && (
            <>
              {/* Barras de progresso */}
              <View className="flex-row mt-14 px-3 gap-1">
                {activeGroup.stories.map((_: any, idx: number) => (
                  <View key={idx} className="h-[3px] flex-1 bg-zinc-700 rounded-full overflow-hidden">
                    {idx < activeStoryIndex ? (
                      // Stories já vistos: barra cheia
                      <View className="h-full w-full bg-white rounded-full" />
                    ) : idx === activeStoryIndex ? (
                      // Story atual: barra animada
                      <Animated.View
                        style={{
                          height: '100%',
                          backgroundColor: 'white',
                          borderRadius: 999,
                          width: storyProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        }}
                      />
                    ) : null}
                  </View>
                ))}
              </View>

              {/* Header */}
              <View className="flex-row items-center justify-between px-4 mt-4">
                <View className="flex-row items-center">
                  <View className={`w-10 h-10 rounded-full border-2 items-center justify-center ${activeGroup.isGlobal ? 'border-red-500 bg-red-900/50' : 'border-[#ff4500] bg-zinc-800'}`}>
                    {activeGroup.isGlobal ? (
                      <Ionicons name="megaphone" size={18} color="white" />
                    ) : (
                      <Text className="text-white font-bold">{activeGroup.sourceName.charAt(0)}</Text>
                    )}
                  </View>
                  <View className="ml-3">
                    <Text className="text-white font-bold text-base">{activeGroup.sourceName}</Text>
                    <Text className="text-gray-400 text-xs">
                      {activeStoryIndex + 1} de {activeGroup.stories.length}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={closeStories} className="p-2">
                  <Ionicons name="close" size={28} color="white" />
                </TouchableOpacity>
              </View>

              {/* Área de toque: esquerda (voltar) / direita (próximo) / segurar (pausar) */}
              <View className="flex-1">
                {/* Conteúdo centralizado */}
                <View className="flex-1 justify-center px-6" pointerEvents="box-none">
                  <Text className="text-white text-3xl font-black text-center leading-[42px]">
                    {activeStory.content}
                  </Text>

                  {/* Enquete do Story */}
                  {activeStory.poll_options && Array.isArray(activeStory.poll_options) && activeStory.poll_options.length > 0 && (
                    <View className="mt-10 w-full">
                      <Text className="text-zinc-400 text-center mb-4 uppercase text-xs font-bold tracking-widest">Enquete</Text>
                      {activeStory.poll_options.map((opt: any, i: number) => {
                        const optText = typeof opt === 'string' ? opt : opt.text;
                        return (
                          <TouchableOpacity key={i} className="bg-zinc-800/80 py-4 px-6 rounded-2xl mb-3 border border-zinc-700 active:bg-[#ff4500]/30">
                            <Text className="text-white text-center font-bold text-lg">{optText}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  {/* Botão CTA para stories globais */}
                  {activeGroup.isGlobal && (
                    <View className="mt-16 items-center w-full">
                      <TouchableOpacity className="bg-[#ff4500] py-4 w-full rounded-2xl flex-row items-center justify-center shadow-lg">
                        <Ionicons name="location-sharp" size={22} color="white" />
                        <Text className="text-white font-black text-base uppercase tracking-widest ml-2">Apoiar no Radar</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Zonas de toque invisíveis sobrepostas */}
                <View className="absolute inset-0 flex-row" pointerEvents="box-none">
                  {/* Lado esquerdo: voltar */}
                  <Pressable
                    onPress={goToPrevStory}
                    onLongPress={pauseStory}
                    onPressOut={() => { if (isStoryPaused) resumeStory(); }}
                    delayLongPress={200}
                    style={{ flex: 1 }}
                  />
                  {/* Lado direito: próximo */}
                  <Pressable
                    onPress={goToNextStory}
                    onLongPress={pauseStory}
                    onPressOut={() => { if (isStoryPaused) resumeStory(); }}
                    delayLongPress={200}
                    style={{ flex: 2 }}
                  />
                </View>

                {/* Indicador de pausa */}
                {isStoryPaused && (
                  <View className="absolute top-4 left-0 right-0 items-center">
                    <View className="bg-black/50 px-3 py-1 rounded-full flex-row items-center">
                      <Ionicons name="pause" size={12} color="white" />
                      <Text className="text-white text-xs font-medium ml-1">Pausado</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Indicador do grupo atual */}
              {storyGroups.length > 1 && (
                <View className="flex-row justify-center pb-10 gap-1.5">
                  {storyGroups.map((_, idx) => (
                    <View key={idx} className={`w-1.5 h-1.5 rounded-full ${idx === activeGroupIndex ? 'bg-white' : 'bg-zinc-600'}`} />
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </Modal>

      {/* =============================== */}
      {/* BOTTOM SHEET: ESCOLHER MÍDIA     */}
      {/* =============================== */}
      <Modal visible={mediaPickerVisible} transparent animationType="none" onRequestClose={closeMediaPicker} statusBarTranslucent>
        <Pressable onPress={closeMediaPicker} className="flex-1 bg-black/60 justify-end">
          <Animated.View style={{ transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [300, 0] }) }] }}>
            <Pressable onPress={() => {}}>
              <View className="bg-zinc-900 rounded-t-3xl pt-4 pb-10 px-6 border-t border-zinc-700">
                <View className="w-10 h-1 bg-zinc-600 rounded-full self-center mb-6" />
                <Text className="text-white font-bold text-lg mb-5">{mediaPickerType === 'image' ? 'Adicionar Imagem' : 'Adicionar Vídeo'}</Text>
                <TouchableOpacity onPress={() => { closeMediaPicker(); setTimeout(() => mediaPickerType === 'image' ? pickImage('camera') : pickVideo('camera'), 300); }} className="flex-row items-center py-4 border-b border-zinc-800" activeOpacity={0.7}>
                  <View className="w-12 h-12 bg-[#ff4500]/15 rounded-2xl items-center justify-center mr-4"><Ionicons name="camera" size={24} color="#ff4500" /></View>
                  <View className="flex-1">
                    <Text className="text-white font-bold text-base">{mediaPickerType === 'image' ? 'Tirar Foto' : 'Gravar Vídeo'}</Text>
                    <Text className="text-gray-500 text-sm mt-0.5">Usar a câmera do dispositivo</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#6b7280" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { closeMediaPicker(); setTimeout(() => mediaPickerType === 'image' ? pickImage('gallery') : pickVideo('gallery'), 300); }} className="flex-row items-center py-4" activeOpacity={0.7}>
                  <View className="w-12 h-12 bg-blue-500/15 rounded-2xl items-center justify-center mr-4"><Ionicons name="images" size={24} color="#3b82f6" /></View>
                  <View className="flex-1">
                    <Text className="text-white font-bold text-base">Escolher da Galeria</Text>
                    <Text className="text-gray-500 text-sm mt-0.5">{mediaPickerType === 'image' ? 'Selecionar uma foto' : 'Selecionar um vídeo'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#6b7280" />
                </TouchableOpacity>
                <TouchableOpacity onPress={closeMediaPicker} className="mt-4 py-3.5 bg-zinc-800 rounded-2xl items-center" activeOpacity={0.7}>
                  <Text className="text-gray-400 font-bold text-base">Cancelar</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* =============================== */}
      {/* FULLSCREEN MEDIA VIEWER          */}
      {/* =============================== */}
      <Modal visible={!!mediaViewer} transparent animationType="fade" onRequestClose={() => setMediaViewer(null)} statusBarTranslucent>
        <View className="flex-1 bg-black">
          <StatusBar barStyle="light-content" backgroundColor="black" />
          <View className="absolute top-0 left-0 right-0 z-10 flex-row justify-between items-center pt-14 px-4 pb-3">
            <TouchableOpacity onPress={() => setMediaViewer(null)} className="w-10 h-10 bg-black/50 rounded-full items-center justify-center" activeOpacity={0.7}>
              <Ionicons name="close" size={24} color="white" />
            </TouchableOpacity>
            {mediaViewer?.type === 'gif' && <View className="bg-white/20 px-3 py-1 rounded-full"><Text className="text-white text-xs font-bold">GIF</Text></View>}
          </View>
          {mediaViewer?.type === 'video' ? (
            <View className="flex-1 justify-center">
              <Video source={{ uri: mediaViewer.url }} style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.7 }} resizeMode={ResizeMode.CONTAIN} shouldPlay isLooping useNativeControls isMuted={false} />
            </View>
          ) : (
            <View className="flex-1 justify-center items-center">
              <Image source={{ uri: mediaViewer?.url }} style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.8 }} resizeMode="contain" />
            </View>
          )}
        </View>
      </Modal>

    </View>
  );
}
