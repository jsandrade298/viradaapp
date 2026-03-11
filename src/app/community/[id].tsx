import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image, ScrollView, StatusBar, FlatList, Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Dimensions, Animated, Pressable, Linking } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import MapView, { Marker } from 'react-native-maps'; // <--- O MAPA ENTROU AQUI!
import { Video, ResizeMode } from 'expo-av';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';

const { width: SW, height: SH } = Dimensions.get('window');

type AttachmentType = 'image' | 'video' | 'gif' | 'document' | null;
interface PostAttachment { uri: string; type: AttachmentType; mimeType?: string; fileName?: string; }
interface PostLocation { name: string; latitude: number; longitude: number; }
interface PollOption { text: string; votes: number; }

export default function CommunityScreen() {
  const { id } = useLocalSearchParams(); 
  const commId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [community, setCommunity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'mural' | 'radar' | 'acervo' | 'membros'>('mural');
  const [isCommunityAdmin, setIsCommunityAdmin] = useState(false);

  // --- STATES DAS ABAS ---
  const [posts, setPosts] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [library, setLibrary] = useState<any[]>([]);
  const [eventCheckins, setEventCheckins] = useState<Set<string>>(new Set());

  // --- INTERAÇÕES DO MURAL ---
  const [userInteractions, setUserInteractions] = useState<Record<string, string[]>>({});
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});
  
  // --- MODAL DE POSTAGEM (MURAL) ---
  const [isPostModalVisible, setIsPostModalVisible] = useState(false);
  const [newPostContent, setNewPostContent] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [attachment, setAttachment] = useState<PostAttachment | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>([]);
  const [showPollEditor, setShowPollEditor] = useState(false);
  const [postLocation, setPostLocation] = useState<PostLocation | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);

  // --- MODAL DE EVENTOS (RADAR) ---
  const [isEventModalVisible, setIsEventModalVisible] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventDate, setNewEventDate] = useState(''); 
  const [newEventTime, setNewEventTime] = useState(''); 
  const [newEventAddress, setNewEventAddress] = useState('');
  const [newEventBanner, setNewEventBanner] = useState<string | null>(null);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any>(null); // Visualização do PIN no mapa

  // --- MÍDIAS (VIEWER E PICKER) ---
  const [mediaPickerVisible, setMediaPickerVisible] = useState(false);
  const [mediaPickerType, setMediaPickerType] = useState<'image' | 'video'>('image');
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const [mediaViewer, setMediaViewer] = useState<{ url: string; type: string } | null>(null);

  useEffect(() => {
    if (commId) fetchCurrentUser();
  }, [commId]);

  useFocusEffect(
    useCallback(() => {
      if (commId && currentUser) {
        fetchCommunityData(); 
        if (activeTab === 'mural') fetchCommunityPosts();
        if (activeTab === 'membros') fetchMembers();
        if (activeTab === 'radar') fetchEvents();
        if (activeTab === 'acervo') fetchLibrary();
      }
    }, [commId, activeTab, currentUser])
  );

  async function fetchCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role, full_name, avatar_url').eq('id', user.id).single();
      setCurrentUser({ ...user, profile });
    }
  }

  async function fetchCommunityData() {
    const { data } = await supabase.from('communities').select('*, community_members(*)').eq('id', commId).single();
    if (data) {
      setCommunity(data);
      const myMembership = data.community_members.find((m: any) => m.user_id === currentUser?.id);
      if (currentUser?.profile?.role === 'SUPER_ADMIN' || myMembership?.is_admin) {
        setIsCommunityAdmin(true);
      }
    }
    setLoading(false);
  }

  async function fetchCommunityPosts() {
    const { data: feedPosts } = await supabase.from('posts').select(`id, content, media_url, media_type, link_url, poll_options, location_name, latitude, longitude, created_at, author_id, profiles!posts_author_id_fkey (full_name, avatar_url)`).eq('community_id', commId).order('created_at', { ascending: false });
    if (feedPosts && feedPosts.length > 0) {
      const postIds = feedPosts.map(p => p.id);
      let commentCountMap: Record<string, number> = {};
      const { data: commentRows } = await supabase.from('comments').select('post_id').in('post_id', postIds);
      if (commentRows) commentRows.forEach(c => { commentCountMap[c.post_id] = (commentCountMap[c.post_id] || 0) + 1; });
      const cMap: Record<string, { APOIAR: number; REPERCUTIR: number; SALVAR: number }> = {};
      const uInts: Record<string, string[]> = {};
      postIds.forEach(pid => { cMap[pid] = { APOIAR: 0, REPERCUTIR: 0, SALVAR: 0 }; });
      const { data: ints } = await supabase.from('post_interactions').select('post_id, interaction_type, user_id').in('post_id', postIds);
      if (ints) ints.forEach(i => {
        if (cMap[i.post_id]) cMap[i.post_id][i.interaction_type as keyof typeof cMap[string]]++;
        if (currentUser && i.user_id === currentUser.id) {
          if (!uInts[i.post_id]) uInts[i.post_id] = [];
          if (!uInts[i.post_id].includes(i.interaction_type)) uInts[i.post_id].push(i.interaction_type);
        }
      });
      if (currentUser) {
        const { data: votesData } = await supabase.from('poll_votes').select('post_id, option_index').eq('user_id', currentUser.id).in('post_id', postIds);
        if (votesData) { const vMap: Record<string, number> = {}; votesData.forEach(v => { vMap[v.post_id] = v.option_index; }); setUserVotes(vMap); }
      }
      setPosts(feedPosts.map(p => ({ ...p, apoiar_count: cMap[p.id]?.APOIAR || 0, repercutir_count: cMap[p.id]?.REPERCUTIR || 0, salvar_count: cMap[p.id]?.SALVAR || 0, comment_count: commentCountMap[p.id] || 0 })));
      setUserInteractions(uInts);
    } else { setPosts([]); }
  }

  async function fetchMembers() {
    const { data } = await supabase.from('community_members').select('*, profiles(full_name, avatar_url, role)').eq('community_id', commId).order('joined_at', { ascending: false });
    if (data) setMembers(data);
  }

  async function fetchEvents() {
    const { data, error } = await supabase.from('events').select('*, profiles!events_creator_id_fkey(full_name)').eq('community_id', commId).gte('event_date', new Date().toISOString()).order('event_date', { ascending: true });
    if (data) {
      setEvents(data);
      if (currentUser) {
        const evIds = data.map(e => e.id);
        const { data: checkins } = await supabase.from('event_checkins').select('event_id').eq('user_id', currentUser.id).in('event_id', evIds);
        if (checkins) {
          const checked = new Set(checkins.map(c => c.event_id));
          setEventCheckins(checked);
        }
      }
    }
  }

  async function fetchLibrary() {
    const { data } = await supabase.from('library_items').select('*, profiles!library_items_uploader_id_fkey(full_name)').eq('community_id', commId).order('created_at', { ascending: false });
    if (data) setLibrary(data);
  }

  // ==========================================
  // LÓGICA DO RADAR (GEOLOCALIZAÇÃO E IMAGEM)
  // ==========================================
  function resetEventModal() {
    setNewEventTitle(''); setNewEventDesc(''); setNewEventDate(''); setNewEventTime(''); setNewEventAddress(''); setNewEventBanner(null);
    setIsEventModalVisible(false);
  }

  async function pickEventBanner() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, allowsEditing: true, aspect: [16, 9], quality: 0.7 });
    if (!result.canceled) setNewEventBanner(result.assets[0].uri);
  }

  function handleDateChange(text: string) {
    const cleaned = text.replace(/\D/g, ''); 
    let formatted = cleaned;
    if (cleaned.length > 2 && cleaned.length <= 4) formatted = cleaned.slice(0, 2) + '/' + cleaned.slice(2);
    else if (cleaned.length > 4) formatted = cleaned.slice(0, 2) + '/' + cleaned.slice(2, 4) + '/' + cleaned.slice(4, 8);
    setNewEventDate(formatted);
  }

  function handleTimeChange(text: string) {
    const cleaned = text.replace(/\D/g, ''); 
    let formatted = cleaned;
    if (cleaned.length > 2) formatted = cleaned.slice(0, 2) + ':' + cleaned.slice(2, 4);
    setNewEventTime(formatted);
  }

  function parseDateTimeToISO(dateStr: string, timeStr: string) {
    try {
      const [day, month, year] = dateStr.split('/');
      const [hours, minutes] = timeStr.split(':');
      if (!day || !month || !year || !hours || !minutes) return null;
      const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hours), parseInt(minutes));
      if (isNaN(dateObj.getTime())) return null;
      return dateObj.toISOString();
    } catch { return null; }
  }

  async function handleCreateEvent() {
    if (!newEventTitle.trim() || newEventDate.length !== 10 || newEventTime.length !== 5) { Alert.alert("Aviso", "Preencha o Título, Data e Hora corretamente."); return; }
    const isoDate = parseDateTimeToISO(newEventDate, newEventTime);
    if (!isoDate) { Alert.alert("Erro de Formato", "Data ou hora inválida."); return; }
    setIsCreatingEvent(true);

    // 1. Upload da Imagem
    let uploadedBannerUrl = null;
    if (newEventBanner && currentUser) {
      try {
        const ext = 'jpg';
        const fn = `events/${currentUser.id}_${Date.now()}.${ext}`;
        const b64 = await FileSystem.readAsStringAsync(newEventBanner, { encoding: 'base64' });
        const { error: uploadError } = await supabase.storage.from('community_media').upload(fn, decode(b64), { contentType: 'image/jpeg' });
        if (!uploadError) {
          uploadedBannerUrl = supabase.storage.from('community_media').getPublicUrl(fn).data.publicUrl;
        }
      } catch (e) { console.warn("Erro no upload da imagem", e); }
    }

    // 2. Geocodificação Automática
    let lat = null, lng = null;
    if (newEventAddress.trim()) {
      try {
        const geocodeResult = await Location.geocodeAsync(newEventAddress.trim());
        if (geocodeResult.length > 0) {
          lat = geocodeResult[0].latitude;
          lng = geocodeResult[0].longitude;
        }
      } catch(err) { console.warn("Erro ao geocodificar", err); }
    }

    // 3. Salvar no Banco
    const { error } = await supabase.from('events').insert({
      community_id: commId,
      title: newEventTitle.trim(),
      description: newEventDesc.trim() || null,
      event_date: isoDate,
      address: newEventAddress.trim() || null,
      latitude: lat,
      longitude: lng,
      banner_url: uploadedBannerUrl,
      creator_id: currentUser.id
    });

    setIsCreatingEvent(false);
    if (error) { Alert.alert("Erro", "Não foi possível criar o evento no Radar."); console.error(error); } 
    else { resetEventModal(); fetchEvents(); }
  }

  async function handleParticipate(eventId: string) {
    if (!currentUser) return;
    const isParticipating = eventCheckins.has(eventId);
    if (isParticipating) {
      await supabase.from('event_checkins').delete().eq('event_id', eventId).eq('user_id', currentUser.id);
      setEventCheckins(prev => { const n = new Set(prev); n.delete(eventId); return n; });
    } else {
      await supabase.from('event_checkins').insert({ event_id: eventId, user_id: currentUser.id });
      setEventCheckins(prev => new Set([...prev, eventId]));
    }
  }

  // ==========================================
  // HELPERS DE RENDERIZAÇÃO DE LISTAS
  // ==========================================
  function formatTimeAgo(d: string) { const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000); if (m < 1) return 'agora'; if (m < 60) return `${m}min`; const h = Math.floor(m / 60); if (h < 24) return `${h}h`; return `${Math.floor(h / 24)}d`; }

  function renderEvent(item: any) {
    const date = new Date(item.event_date);
    const isParticipating = eventCheckins.has(item.id);

    return (
      <View className="bg-zinc-900 mb-5 mx-4 rounded-2xl border border-zinc-800 overflow-hidden shadow-lg">
        {item.banner_url && (
          <Image source={{ uri: item.banner_url }} className="w-full h-40 bg-zinc-800" resizeMode="cover" />
        )}
        <View className="p-5">
          <View className="flex-row items-center justify-between mb-3">
            <View className="bg-[#ff4500]/15 px-3 py-1.5 rounded-full flex-row items-center">
              <Ionicons name="calendar" size={14} color="#ff4500" />
              <Text className="text-[#ff4500] font-bold text-xs ml-1.5">{date.toLocaleDateString('pt-BR')} às {date.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</Text>
            </View>
            <Ionicons name="megaphone-outline" size={22} color="#ff4500" />
          </View>
          <Text className="text-white font-black text-xl mb-2">{item.title}</Text>
          {item.description && <Text className="text-zinc-400 text-sm leading-5 mb-4">{item.description}</Text>}
          {item.address && (
            <View className="flex-row items-center mb-5 bg-zinc-800/50 p-3 rounded-xl border border-zinc-800">
              <Ionicons name="location" size={18} color="#9ca3af" />
              <Text className="text-zinc-300 text-xs ml-2 flex-1 font-medium">{item.address}</Text>
            </View>
          )}
          <TouchableOpacity 
            onPress={() => handleParticipate(item.id)}
            className={`py-3.5 rounded-xl items-center shadow-sm flex-row justify-center ${isParticipating ? 'bg-zinc-800 border border-zinc-700' : 'bg-[#ff4500]'}`} 
            activeOpacity={0.8}
          >
            {isParticipating && <Ionicons name="checkmark-circle" size={18} color="#10b981" className="mr-2" />}
            <Text className={`font-black uppercase tracking-widest text-sm ${isParticipating ? 'text-emerald-500' : 'text-white'}`}>
              {isParticipating ? 'Presença Confirmada' : 'Vou Participar'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ==========================================
  // RENDERIZAÇÃO DA TELA PRINCIPAL
  // ==========================================
  if (loading) return <View className="flex-1 bg-[#1a1a1a] justify-center items-center"><ActivityIndicator size="large" color="#ff4500" /></View>;
  if (!community) return <View className="flex-1 bg-[#1a1a1a] justify-center items-center"><Text className="text-white">Comunidade não encontrada.</Text></View>;

  const memberCount = community.community_members?.length || 0;

  return (
    <View className="flex-1 bg-[#1a1a1a]">
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      <TouchableOpacity onPress={() => router.back()} className="absolute top-12 left-4 z-10 w-10 h-10 bg-black/50 rounded-full items-center justify-center">
        <Ionicons name="arrow-back" size={24} color="white" />
      </TouchableOpacity>

      <FlatList
        data={activeTab === 'mural' ? posts : activeTab === 'radar' ? events : activeTab === 'acervo' ? library : members}
        keyExtractor={(item) => item.id || item.user_id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListHeaderComponent={() => (
          <View className="mb-4">
            {community.cover_url ? <Image source={{ uri: community.cover_url }} className="w-full h-40 bg-zinc-800" resizeMode="cover" /> : <View className="w-full h-40 bg-zinc-800 items-center justify-center"><Ionicons name="image-outline" size={32} color="#3f3f46" /></View>}
            <View className="px-5 pb-5 border-b border-zinc-800">
              <View className="flex-row justify-between items-end -mt-10 mb-3">
                {community.avatar_url ? <Image source={{ uri: community.avatar_url }} className="w-20 h-20 rounded-2xl border-4 border-[#1a1a1a] bg-zinc-900" /> : <View className={`w-20 h-20 rounded-2xl border-4 border-[#1a1a1a] items-center justify-center ${community.is_private ? 'bg-red-900' : 'bg-[#ff4500]'}`}><Text className="text-white font-bold text-3xl">{community.name.charAt(0)}</Text></View>}
              </View>
              <Text className="text-white text-2xl font-black mb-1">{community.name}</Text>
              {community.description && <Text className="text-gray-400 text-sm leading-5 mb-3">{community.description}</Text>}
              <View className="flex-row items-center">
                <Ionicons name="people" size={16} color="#6b7280" />
                <Text className="text-zinc-400 text-xs font-medium ml-1.5">{memberCount} {memberCount === 1 ? 'membro' : 'membros'}</Text>
                {community.is_private && <><Text className="text-zinc-600 mx-2">•</Text><Ionicons name="lock-closed" size={12} color="#ef4444" /><Text className="text-red-400 text-xs font-bold ml-1">Fechada</Text></>}
              </View>
            </View>
            <View className="flex-row border-b border-zinc-800 px-2 mb-2">
              {['mural', 'radar', 'acervo', 'membros'].map((tab) => (
                <TouchableOpacity key={tab} onPress={() => setActiveTab(tab as any)} className={`flex-1 items-center py-4 ${activeTab === tab ? 'border-b-2 border-[#ff4500]' : ''}`}>
                  <Text className={`font-bold capitalize ${activeTab === tab ? 'text-white' : 'text-zinc-500'}`}>{tab}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* MAPA INTERATIVO (Só aparece na aba Radar se houver eventos com coordenadas) */}
            {activeTab === 'radar' && events.some(e => e.latitude && e.longitude) && (
              <View className="mx-4 mb-5 rounded-2xl overflow-hidden border border-zinc-800" style={{ height: 220 }}>
                <MapView
                  style={{ flex: 1 }}
                  initialRegion={{
                    latitude: events.find(e => e.latitude)?.latitude || -23.6666,
                    longitude: events.find(e => e.longitude)?.longitude || -46.5322,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                  }}
                >
                  {events.filter(e => e.latitude && e.longitude).map(e => (
                    <Marker
                      key={e.id}
                      coordinate={{ latitude: e.latitude, longitude: e.longitude }}
                      onPress={() => setSelectedEvent(e)}
                    >
                      <View className="bg-[#ff4500] p-2 rounded-full border-2 border-white shadow-lg"><Ionicons name="megaphone" size={14} color="white" /></View>
                    </Marker>
                  ))}
                </MapView>
                <View className="absolute bottom-2 left-0 right-0 items-center pointer-events-none">
                  <View className="bg-black/70 px-3 py-1 rounded-full"><Text className="text-white text-[10px] font-bold">Toque nos pins para ver detalhes</Text></View>
                </View>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={() => (
          <View className="py-16 items-center justify-center px-6">
            <Ionicons name={activeTab === 'mural' ? 'chatbubbles-outline' : activeTab === 'radar' ? 'calendar-outline' : activeTab === 'acervo' ? 'library-outline' : 'people-outline'} size={56} color="#3f3f46" />
            <Text className="text-zinc-400 font-bold text-lg mt-4 text-center">Nenhum dado encontrado</Text>
          </View>
        )}
        renderItem={({ item }) => {
          if (activeTab === 'radar') return renderEvent(item);
          return null; // As outras abas ficam vazias no boilerplate pra focar no Radar agora
        }}
      />

      {/* FAB DO RADAR */}
      {activeTab === 'radar' && isCommunityAdmin && (
        <TouchableOpacity onPress={() => setIsEventModalVisible(true)} className="absolute bottom-12 right-6 w-14 h-14 bg-[#ff4500] rounded-full items-center justify-center shadow-2xl elevation-5" activeOpacity={0.8}>
          <Ionicons name="add" size={32} color="#ffffff" />
        </TouchableOpacity>
      )}

      {/* MODAL DO PIN DO MAPA */}
      <Modal visible={!!selectedEvent} transparent animationType="fade" onRequestClose={() => setSelectedEvent(null)}>
        <Pressable className="flex-1 bg-black/60 justify-end" onPress={() => setSelectedEvent(null)}>
          <Pressable onPress={() => {}}>
            {selectedEvent && (
              <View className="bg-zinc-900 rounded-t-3xl border-t border-zinc-700 pb-10">
                <View className="w-10 h-1 bg-zinc-600 rounded-full self-center my-4" />
                {renderEvent(selectedEvent)}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL DE CRIAÇÃO DE EVENTO (RADAR) */}
      <Modal visible={isEventModalVisible} animationType="slide" transparent={false} onRequestClose={resetEventModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-[#1a1a1a]">
          <View className="flex-row justify-between items-center px-4 pt-14 pb-4 border-b border-zinc-800">
            <TouchableOpacity onPress={resetEventModal}><Text className="text-gray-400 font-bold text-base">Cancelar</Text></TouchableOpacity>
            <Text className="text-white font-bold text-lg">Nova Convocação</Text>
            <TouchableOpacity onPress={handleCreateEvent} disabled={!newEventTitle.trim() || newEventDate.length !== 10 || newEventTime.length !== 5 || isCreatingEvent}>
              {isCreatingEvent ? <ActivityIndicator size="small" color="#ff4500" /> : <Text className={`font-bold text-base ${newEventTitle.trim() && newEventDate.length === 10 && newEventTime.length === 5 ? 'text-[#ff4500]' : 'text-zinc-600'}`}>Salvar</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-6 pt-6" keyboardShouldPersistTaps="handled">
            
            {/* NOVO: ÁREA DO BANNER */}
            <TouchableOpacity onPress={pickEventBanner} activeOpacity={0.8} className="w-full h-36 bg-zinc-800 rounded-2xl items-center justify-center overflow-hidden border border-zinc-700 mb-6 relative">
                {newEventBanner ? (
                  <><Image source={{ uri: newEventBanner }} className="w-full h-full opacity-90" resizeMode="cover" /><View className="absolute bg-black/60 p-2 rounded-full"><Ionicons name="pencil" size={16} color="white" /></View></>
                ) : (
                  <View className="items-center"><Ionicons name="image-outline" size={32} color="#6b7280" /><Text className="text-zinc-500 text-xs mt-2 font-medium uppercase tracking-widest">Capa do Evento</Text></View>
                )}
            </TouchableOpacity>

            <Text className="text-zinc-400 font-bold text-xs uppercase tracking-widest mb-2">Título da Ação</Text>
            <TextInput className="bg-zinc-900 border border-zinc-800 text-white rounded-xl px-4 py-4 text-base mb-6" placeholder="Ex: Panfletagem na Estação" placeholderTextColor="#6b7280" value={newEventTitle} onChangeText={setNewEventTitle} />

            <View className="flex-row gap-4 mb-6">
              <View className="flex-1">
                <Text className="text-zinc-400 font-bold text-xs uppercase tracking-widest mb-2">Data</Text>
                <TextInput className="bg-zinc-900 border border-zinc-800 text-white rounded-xl px-4 py-4 text-base text-center" placeholder="DD/MM/AAAA" placeholderTextColor="#6b7280" keyboardType="numeric" maxLength={10} value={newEventDate} onChangeText={handleDateChange} />
              </View>
              <View className="flex-1">
                <Text className="text-zinc-400 font-bold text-xs uppercase tracking-widest mb-2">Horário</Text>
                <TextInput className="bg-zinc-900 border border-zinc-800 text-white rounded-xl px-4 py-4 text-base text-center" placeholder="HH:MM" placeholderTextColor="#6b7280" keyboardType="numeric" maxLength={5} value={newEventTime} onChangeText={handleTimeChange} />
              </View>
            </View>

            <Text className="text-zinc-400 font-bold text-xs uppercase tracking-widest mb-2">Local (Para o Mapa)</Text>
            <TextInput className="bg-zinc-900 border border-zinc-800 text-white rounded-xl px-4 py-4 text-base mb-6" placeholder="Rua, Número, Cidade" placeholderTextColor="#6b7280" value={newEventAddress} onChangeText={setNewEventAddress} />

            <Text className="text-zinc-400 font-bold text-xs uppercase tracking-widest mb-2">Instruções</Text>
            <TextInput className="bg-zinc-900 border border-zinc-800 text-white rounded-xl px-4 py-4 text-base mb-8" placeholder="O que levar? Onde encontrar?" placeholderTextColor="#6b7280" multiline numberOfLines={4} style={{ textAlignVertical: 'top' }} value={newEventDesc} onChangeText={setNewEventDesc} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}