import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Alert, RefreshControl, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

export default function CommunitiesScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'minhas' | 'explorar'>('minhas');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const [myCommunities, setMyCommunities] = useState<any[]>([]);
  const [exploreCommunities, setExploreCommunities] = useState<any[]>([]);
  
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>('MILITANTE');

  // Modal de Criação
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newCommName, setNewCommName] = useState('');
  const [newCommDesc, setNewCommDesc] = useState('');
  const [newCommIsPrivate, setNewCommIsPrivate] = useState(false);
  
  // Novas Mídias
  const [newCommAvatar, setNewCommAvatar] = useState<string | null>(null);
  const [newCommCover, setNewCommCover] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single();
    setCurrentUser(user);
    if (profile) setUserRole(profile.role);

    await loadCommunities(user.id);
    setLoading(false);
  }

  async function loadCommunities(userId: string) {
    const { data: myCommsData } = await supabase.from('community_members').select('community_id, is_admin, communities(*)').eq('user_id', userId);
    const myComms = myCommsData?.map(c => ({ ...c.communities, is_admin: c.is_admin })) || [];
    setMyCommunities(myComms);

    const myCommIds = myComms.map((c: any) => c.id);
    let exploreQuery = supabase.from('communities').select('*').eq('is_private', false);
    if (myCommIds.length > 0) exploreQuery = exploreQuery.not('id', 'in', `(${myCommIds.join(',')})`);
    
    const { data: exploreComms } = await exploreQuery.order('created_at', { ascending: false });
    setExploreCommunities(exploreComms || []);
  }

  async function onRefresh() {
    setRefreshing(true);
    if (currentUser) await loadCommunities(currentUser.id);
    setRefreshing(false);
  }

  // Lógica para escolher imagens
  async function pickImage(type: 'avatar' | 'cover') {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: type === 'avatar' ? [1, 1] : [16, 9], // Quadrado para ícone, Retângulo para Capa
      quality: 0.7,
    });

    if (!result.canceled) {
      if (type === 'avatar') setNewCommAvatar(result.assets[0].uri);
      else setNewCommCover(result.assets[0].uri);
    }
  }

  // Função para subir as imagens para o Supabase
  async function uploadImage(uri: string, pathFolder: string): Promise<string | null> {
    try {
      const ext = 'jpg';
      const fileName = `${pathFolder}/${Date.now()}.${ext}`;
      const base64Data = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      
      const { error } = await supabase.storage.from('community_media').upload(fileName, decode(base64Data), { contentType: 'image/jpeg' });
      if (error) throw error;
      
      const { data: { publicUrl } } = supabase.storage.from('community_media').getPublicUrl(fileName);
      return publicUrl;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async function handleCreateCommunity() {
    if (!newCommName.trim()) { Alert.alert('Aviso', 'O nome da comunidade é obrigatório.'); return; }
    setIsCreating(true);
    
    let avatarUrl = null;
    let coverUrl = null;

    // Sobe as imagens se foram escolhidas
    if (newCommAvatar) avatarUrl = await uploadImage(newCommAvatar, 'avatars');
    if (newCommCover) coverUrl = await uploadImage(newCommCover, 'covers');
    
    const { data: newComm, error } = await supabase.from('communities').insert({
      name: newCommName.trim(),
      description: newCommDesc.trim(),
      is_private: newCommIsPrivate,
      avatar_url: avatarUrl,
      cover_url: coverUrl,
      created_by: currentUser.id
    }).select().single();

    if (error || !newComm) {
      Alert.alert('Erro', 'Não foi possível criar a comunidade.');
      setIsCreating(false);
      return;
    }

    await supabase.from('community_members').insert({ community_id: newComm.id, user_id: currentUser.id, is_admin: true });

    setIsCreating(false);
    setIsCreateModalVisible(false);
    setNewCommName(''); setNewCommDesc(''); setNewCommIsPrivate(false); setNewCommAvatar(null); setNewCommCover(null);
    
    await loadCommunities(currentUser.id);
    setActiveTab('minhas');
  }

  async function handleJoinCommunity(communityId: string) {
    if (!currentUser) return;
    const { error } = await supabase.from('community_members').insert({ community_id: communityId, user_id: currentUser.id, is_admin: false });
    if (error) Alert.alert('Erro', 'Não foi possível entrar na comunidade.');
    else { await loadCommunities(currentUser.id); setActiveTab('minhas'); }
  }

  if (loading) return <View className="flex-1 bg-[#1a1a1a] justify-center items-center"><ActivityIndicator size="large" color="#ff4500" /></View>;

  return (
    <View className="flex-1 bg-[#1a1a1a]">
      {/* HEADER */}
      <View className="pt-14 pb-2 px-6 bg-[#1a1a1a]">
        <Text className="text-white text-3xl font-black tracking-wide mb-4">Comunidades</Text>
        <View className="flex-row border-b border-zinc-800">
          <TouchableOpacity onPress={() => setActiveTab('minhas')} className={`mr-8 pb-3 ${activeTab === 'minhas' ? 'border-b-2 border-[#ff4500]' : ''}`}>
            <Text className={`font-bold text-base ${activeTab === 'minhas' ? 'text-white' : 'text-zinc-500'}`}>Minhas</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('explorar')} className={`pb-3 ${activeTab === 'explorar' ? 'border-b-2 border-[#ff4500]' : ''}`}>
            <Text className={`font-bold text-base ${activeTab === 'explorar' ? 'text-white' : 'text-zinc-500'}`}>Explorar</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* LISTAGEM */}
      <FlatList
        data={activeTab === 'minhas' ? myCommunities : exploreCommunities}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff4500" />}
        ListEmptyComponent={() => (
          <View className="items-center justify-center pt-20 px-6">
            <Ionicons name="people-outline" size={64} color="#3f3f46" />
            <Text className="text-zinc-400 font-bold text-lg mt-4 text-center">{activeTab === 'minhas' ? 'Você ainda não faz parte de nenhuma comunidade.' : 'Nenhuma comunidade aberta encontrada.'}</Text>
            {activeTab === 'minhas' && <TouchableOpacity onPress={() => setActiveTab('explorar')} className="mt-6 bg-zinc-800 px-6 py-3 rounded-full"><Text className="text-white font-bold">Explorar Núcleos</Text></TouchableOpacity>}
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity 
            activeOpacity={0.8}
            onPress={() => {
              router.push(`/community/${item.id}`);
            }}
            className="bg-zinc-900 rounded-2xl p-4 mb-4 border border-zinc-800 flex-row items-center"
          >
            {/* Ícone da Comunidade na Lista */}
            {item.avatar_url ? (
              <Image source={{ uri: item.avatar_url }} className="w-14 h-14 rounded-xl mr-4 border border-zinc-700" />
            ) : (
              <View className={`w-14 h-14 rounded-xl items-center justify-center mr-4 border-2 ${item.is_private ? 'border-red-500/50 bg-red-500/10' : 'border-[#ff4500]/50 bg-[#ff4500]/10'}`}>
                <Text className={`font-bold text-xl ${item.is_private ? 'text-red-500' : 'text-[#ff4500]'}`}>{item.name.charAt(0)}</Text>
              </View>
            )}

            <View className="flex-1">
              <View className="flex-row items-center mb-1">
                {item.is_private && <Ionicons name="lock-closed" size={12} color="#ef4444" className="mr-1.5" />}
                <Text className="text-white font-bold text-base" numberOfLines={1}>{item.name}</Text>
              </View>
              <Text className="text-zinc-400 text-sm leading-5" numberOfLines={2}>{item.description || 'Nenhuma descrição fornecida para este núcleo.'}</Text>
              
              {activeTab === 'minhas' && item.is_admin && (
                <View className="self-start mt-2 bg-blue-500/20 px-2 py-0.5 rounded border border-blue-500/30"><Text className="text-blue-400 text-[10px] font-black uppercase tracking-wider">Admin</Text></View>
              )}
            </View>

            {activeTab === 'explorar' && <TouchableOpacity onPress={() => handleJoinCommunity(item.id)} className="ml-3 bg-[#ff4500] px-4 py-2 rounded-full"><Text className="text-white font-bold text-sm">Entrar</Text></TouchableOpacity>}
            {activeTab === 'minhas' && <Ionicons name="chevron-forward" size={20} color="#6b7280" />}
          </TouchableOpacity>
        )}
      />

      {userRole === 'SUPER_ADMIN' && (
        <TouchableOpacity onPress={() => setIsCreateModalVisible(true)} className="absolute bottom-6 right-6 w-14 h-14 bg-red-600 rounded-full items-center justify-center shadow-2xl elevation-5">
          <Ionicons name="add" size={32} color="#ffffff" />
        </TouchableOpacity>
      )}

      {/* MODAL DE CRIAÇÃO COMPLETO */}
      <Modal visible={isCreateModalVisible} animationType="slide" transparent={false} onRequestClose={() => setIsCreateModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-[#1a1a1a]">
          <View className="flex-row justify-between items-center px-4 pt-14 pb-4 border-b border-zinc-800">
            <TouchableOpacity onPress={() => setIsCreateModalVisible(false)}><Text className="text-gray-400 font-bold text-base">Cancelar</Text></TouchableOpacity>
            <Text className="text-white font-bold text-lg">Novo Núcleo</Text>
            <TouchableOpacity onPress={handleCreateCommunity} disabled={isCreating || !newCommName.trim()}>
              {isCreating ? <ActivityIndicator size="small" color="#ff4500" /> : <Text className={`font-bold text-base ${newCommName.trim() ? 'text-[#ff4500]' : 'text-zinc-600'}`}>Criar</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1 px-6 pt-6" keyboardShouldPersistTaps="handled">
            
            {/* ÁREA DE IDENTIDADE VISUAL */}
            <View className="mb-10">
              {/* Capa */}
              <TouchableOpacity onPress={() => pickImage('cover')} activeOpacity={0.8} className="w-full h-32 bg-zinc-800 rounded-2xl items-center justify-center overflow-hidden border border-zinc-700 relative">
                {newCommCover ? (
                  <>
                    <Image source={{ uri: newCommCover }} className="w-full h-full opacity-80" resizeMode="cover" />
                    <View className="absolute bg-black/50 p-2 rounded-full"><Ionicons name="pencil" size={16} color="white" /></View>
                  </>
                ) : (
                  <View className="items-center"><Ionicons name="image-outline" size={28} color="#6b7280" /><Text className="text-zinc-500 text-xs mt-1 font-medium uppercase tracking-widest">Adicionar Capa</Text></View>
                )}
              </TouchableOpacity>
              
              {/* Avatar (Ícone) sobreposto */}
              <TouchableOpacity onPress={() => pickImage('avatar')} activeOpacity={0.9} className="absolute -bottom-6 left-4 w-[76px] h-[76px] bg-zinc-900 rounded-2xl border-4 border-[#1a1a1a] items-center justify-center overflow-hidden z-10 shadow-lg">
                {newCommAvatar ? (
                  <Image source={{ uri: newCommAvatar }} className="w-full h-full" resizeMode="cover" />
                ) : (
                  <Ionicons name="camera-outline" size={26} color="#6b7280" />
                )}
              </TouchableOpacity>
            </View>

            <Text className="text-zinc-400 font-bold text-xs uppercase tracking-widest mb-2">Nome da Comunidade</Text>
            <TextInput className="bg-zinc-900 border border-zinc-800 text-white rounded-xl px-4 py-4 text-base mb-6" placeholder="Ex: Núcleo de Mulheres" placeholderTextColor="#6b7280" value={newCommName} onChangeText={setNewCommName} maxLength={50} />

            <Text className="text-zinc-400 font-bold text-xs uppercase tracking-widest mb-2">Descrição (Opcional)</Text>
            <TextInput className="bg-zinc-900 border border-zinc-800 text-white rounded-xl px-4 py-4 text-base mb-8" placeholder="Qual o foco desta frente?" placeholderTextColor="#6b7280" multiline numberOfLines={4} style={{ textAlignVertical: 'top' }} value={newCommDesc} onChangeText={setNewCommDesc} />

            <View className="flex-row items-center justify-between bg-zinc-900 p-5 rounded-xl border border-zinc-800 mb-10">
              <View className="flex-1 mr-4">
                <Text className="text-white font-bold text-base mb-1">Comunidade Fechada</Text>
                <Text className="text-zinc-500 text-xs leading-4">Apenas Super-Admins poderão gerenciar a entrada. Ela ficará oculta na aba Explorar.</Text>
              </View>
              <TouchableOpacity onPress={() => setNewCommIsPrivate(!newCommIsPrivate)} className={`w-14 h-8 rounded-full justify-center px-1 ${newCommIsPrivate ? 'bg-red-600' : 'bg-zinc-700'}`}>
                <View className={`w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${newCommIsPrivate ? 'translate-x-6' : 'translate-x-0'}`} />
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}