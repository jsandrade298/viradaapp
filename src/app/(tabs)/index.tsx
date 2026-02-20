import React, { useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';

export default function FeedScreen() {
  const [posts, setPosts] = useState<any[]>([]);
  const [megafone, setMegafone] = useState<any>(null);
  const [stories, setStories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeStory, setActiveStory] = useState<any>(null);

  const [isPostModalVisible, setIsPostModalVisible] = useState(false);
  const [newPostContent, setNewPostContent] = useState('');
  
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    fetchFeed();
  }, []);

  async function fetchFeed() {
    const { data: megafoneData } = await supabase.from('announcements').select('*').eq('is_global', true).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).single();
    if (megafoneData) {
      megafoneData.action_label = "Apoiar no Radar";
      setMegafone(megafoneData);
    }

    const { data: storiesData } = await supabase.from('announcements').select('id, content, communities(name)').eq('is_global', false).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
    if (storiesData) {
      if (storiesData.length > 0) {
        storiesData[0].poll_options = ["Sim, vamos nessa", "Acho melhor mudar a data", "Preciso de mais informações"];
      }
      setStories(storiesData);
    }

    const { data: feedPosts } = await supabase.from('posts').select(`id, content, media_url, media_type, created_at, profiles (full_name), communities (name)`).order('created_at', { ascending: false });
    if (feedPosts) setPosts(feedPosts);

    setLoading(false);
  }

  // --- NOVA FUNÇÃO: MENU DE ESCOLHA (CÂMERA OU GALERIA) ---
  function handleMediaSelect() {
    Alert.alert(
      "Adicionar Imagem",
      "Escolha a origem da foto",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Tirar Foto", onPress: openCamera },
        { text: "Escolher da Galeria", onPress: openGallery }
      ]
    );
  }

  async function openCamera() {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert("Permissão negada", "Precisamos de acesso à câmera para tirar fotos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'] as any, // Corrigido o aviso do Expo
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) {
      setMediaUri(result.assets[0].uri);
    }
  }

  async function openGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any, // Corrigido o aviso do Expo
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) {
      setMediaUri(result.assets[0].uri);
    }
  }

  // --- FUNÇÃO BLINDADA DE UPLOAD ---
  async function handleCreatePost() {
    if (newPostContent.trim().length === 0 && !mediaUri) return;
    setIsPublishing(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert("Erro de Autenticação", "Não foi possível identificar o utilizador.");
      setIsPublishing(false);
      return;
    }

    let publicMediaUrl = null;
    let finalMediaType = null;

    if (mediaUri) {
      try {
        const fileName = `${user.id}/${Date.now()}.jpg`; 
        
        // A SOLUÇÃO MÁGICA: XMLHttpRequest para contornar o bug do fetch no React Native
        const blob = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.onload = function() { resolve(xhr.response); };
          xhr.onerror = function(e) { reject(new TypeError('Network request failed')); };
          xhr.responseType = 'blob';
          xhr.open('GET', mediaUri, true);
          xhr.send(null);
        });

        const { error: uploadError } = await supabase.storage
          .from('post_media')
          .upload(fileName, blob as Blob, { contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('post_media')
          .getPublicUrl(fileName);
          
        publicMediaUrl = publicUrl;
        finalMediaType = 'image';
      } catch (err) {
        console.error(err);
        Alert.alert("Erro no Upload", "Não conseguimos enviar a sua foto. Verifique a conexão.");
        setIsPublishing(false);
        return;
      }
    }

    const { error } = await supabase.from('posts').insert({
      author_id: user.id,
      content: newPostContent.trim(),
      media_url: publicMediaUrl,
      media_type: finalMediaType
    });

    setIsPublishing(false);

    if (error) {
      Alert.alert("Erro ao publicar", "Houve um problema ao enviar a sua publicação.");
      console.error(error);
    } else {
      setNewPostContent('');
      setMediaUri(null); 
      setIsPostModalVisible(false);
      fetchFeed(); 
    }
  }

  if (loading) {
    return <View className="flex-1 bg-[#1a1a1a] justify-center items-center"><ActivityIndicator size="large" color="#ff4500" /></View>;
  }

  return (
    <View className="flex-1 bg-[#1a1a1a]">
      
      <View className="pt-14 pb-4 px-6 flex-row justify-between items-center bg-[#1a1a1a] border-b border-zinc-800">
        <Text className="text-white text-2xl font-black tracking-wide">Mobiliza</Text>
        <View className="flex-row items-center">
          <TouchableOpacity className="mr-5 relative">
            <Ionicons name="notifications-outline" size={24} color="white" />
            <View className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#ff4500] rounded-full border border-[#1a1a1a]" />
          </TouchableOpacity>
          <TouchableOpacity>
            <Ionicons name="chatbubbles-outline" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View className="mb-6">
            <Text className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-4 ml-1">Radar de Ações</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
              {megafone && (
                <TouchableOpacity onPress={() => setActiveStory({ ...megafone, isGlobal: true, communities: { name: 'Coordenação Geral' } })} className="items-center mr-6 ml-1 relative">
                  <View className="w-[68px] h-[68px] rounded-full border-2 border-red-500 p-[2px] items-center justify-center mb-1">
                    <View className="flex-1 w-full h-full rounded-full bg-red-900/80 items-center justify-center">
                      <Ionicons name="megaphone" size={28} color="#ffffff" />
                    </View>
                  </View>
                  <View className="absolute bottom-4 bg-red-600 px-2 py-0.5 rounded border border-[#1a1a1a]">
                    <Text className="text-white text-[9px] font-black uppercase tracking-wider">Urgente</Text>
                  </View>
                  <Text className="text-red-400 text-xs text-center w-20 font-bold mt-1" numberOfLines={1}>Coordenação</Text>
                </TouchableOpacity>
              )}
              {stories.map(story => (
                <TouchableOpacity key={story.id} onPress={() => setActiveStory(story)} className="items-center mr-5 mt-1">
                  <View className="w-16 h-16 rounded-full border-2 border-[#ff4500] p-[2px] mb-1">
                    <View className="flex-1 rounded-full bg-zinc-800 items-center justify-center">
                      <Text className="text-white font-bold text-xl">{story.communities?.name?.charAt(0) || 'C'}</Text>
                    </View>
                  </View>
                  <Text className="text-gray-300 text-xs text-center w-16" numberOfLines={1}>{story.communities?.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        renderItem={({ item }) => (
          <View className="bg-zinc-900 rounded-xl p-5 mb-4 border border-zinc-800 shadow-sm">
            <View className="flex-row items-center mb-4">
              <View className="w-10 h-10 bg-zinc-700 rounded-full items-center justify-center">
                <Text className="text-white font-bold text-lg">{item.profiles?.full_name?.charAt(0) || '?'}</Text>
              </View>
              <View className="ml-3 flex-1">
                <View className="flex-row items-center">
                  <Text className="text-white font-bold text-base mr-1">{item.profiles?.full_name}</Text>
                </View>
                <View className="flex-row items-center mt-0.5">
                  <Ionicons name="people" size={12} color="#9ca3af" />
                  <Text className="text-gray-400 text-xs ml-1 font-medium">{item.communities?.name || 'Feed Geral'}</Text>
                </View>
              </View>
            </View>
            
            {item.content ? <Text className="text-gray-200 text-base leading-6 mb-4">{item.content}</Text> : null}
            
            {item.media_url && item.media_type === 'image' && (
              <Image 
                source={{ uri: item.media_url }} 
                className="w-full h-48 rounded-xl mb-4" 
                resizeMode="cover" 
              />
            )}

            <View className="flex-row items-center justify-between border-t border-zinc-800 pt-4 px-1">
              <View className="flex-row items-center">
                <TouchableOpacity className="flex-row items-center mr-8">
                  <Ionicons name="flame-outline" size={22} color="#9ca3af" />
                  <Text className="text-gray-400 text-sm font-medium ml-1.5">12</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-row items-center mr-8">
                  <Ionicons name="chatbubble-outline" size={20} color="#9ca3af" />
                  <Text className="text-gray-400 text-sm font-medium ml-1.5">4</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-row items-center">
                  <Ionicons name="repeat" size={22} color="#9ca3af" />
                  <Text className="text-gray-400 text-sm font-medium ml-1.5">2</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity>
                <Ionicons name="bookmark-outline" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <TouchableOpacity 
        onPress={() => setIsPostModalVisible(true)}
        className="absolute bottom-6 right-6 w-14 h-14 bg-[#ff4500] rounded-full items-center justify-center shadow-2xl elevation-5"
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={32} color="#ffffff" />
      </TouchableOpacity>

      <Modal 
        visible={isPostModalVisible} 
        animationType="slide" 
        transparent={false} 
        onRequestClose={() => { setIsPostModalVisible(false); setMediaUri(null); setNewPostContent(''); }}
        onShow={() => inputRef.current?.focus()} 
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-[#1a1a1a]">
          
          <View className="flex-row justify-between items-center px-4 pt-14 pb-4 border-b border-zinc-800">
            <TouchableOpacity onPress={() => { setIsPostModalVisible(false); setMediaUri(null); setNewPostContent(''); }}>
              <Text className="text-gray-400 font-bold text-base">Cancelar</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={handleCreatePost}
              className={`${newPostContent.trim().length > 0 || mediaUri ? 'bg-[#ff4500]' : 'bg-zinc-700'} px-5 py-2 rounded-full flex-row items-center justify-center min-w-[80px]`} 
              disabled={(newPostContent.trim().length === 0 && !mediaUri) || isPublishing}
            >
              {isPublishing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text className={`${newPostContent.trim().length > 0 || mediaUri ? 'text-white' : 'text-gray-400'} font-bold text-sm`}>Publicar</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1 px-4 pt-5" keyboardShouldPersistTaps="handled">
            <View className="flex-row">
              <View className="w-10 h-10 bg-zinc-700 rounded-full items-center justify-center mr-3 mt-1">
                <Text className="text-white font-bold text-lg">J</Text>
              </View>
              <View className="flex-1">
                <TextInput
                  ref={inputRef} 
                  className="text-white text-lg leading-7"
                  placeholder="O que está a organizar hoje?"
                  placeholderTextColor="#6b7280"
                  multiline={true}
                  value={newPostContent}
                  onChangeText={setNewPostContent}
                  style={{ textAlignVertical: 'top', minHeight: mediaUri ? 100 : 200 }}
                />

                {mediaUri && (
                  <View className="mt-4 relative mb-10">
                    <Image source={{ uri: mediaUri }} className="w-full h-48 rounded-xl" resizeMode="cover" />
                    <TouchableOpacity 
                      onPress={() => setMediaUri(null)}
                      className="absolute top-2 right-2 bg-black/70 p-1.5 rounded-full"
                    >
                      <Ionicons name="close" size={20} color="white" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>

          <View className="flex-row items-center justify-between px-5 py-4 bg-zinc-900 border-t border-zinc-800 pb-8">
            <View className="flex-row gap-5 items-center">
              {/* BOTÃO DA CÂMERA AGORA COM MENU (CÂMERA OU GALERIA) */}
              <TouchableOpacity onPress={handleMediaSelect}>
                <Ionicons name="image-outline" size={24} color="#ff4500" />
              </TouchableOpacity>
              
              <TouchableOpacity className="border-2 border-[#ff4500] rounded px-1.5 py-0.5 justify-center items-center">
                 <Text className="text-[#ff4500] font-black text-[10px]">GIF</Text>
              </TouchableOpacity>
              <TouchableOpacity><Ionicons name="videocam-outline" size={26} color="#ff4500" /></TouchableOpacity>
              <TouchableOpacity><Ionicons name="document-text-outline" size={24} color="#ff4500" /></TouchableOpacity>
              <TouchableOpacity><Ionicons name="link-outline" size={26} color="#ff4500" /></TouchableOpacity>
              <TouchableOpacity><Ionicons name="bar-chart-outline" size={24} color="#ff4500" /></TouchableOpacity>
            </View>
            <TouchableOpacity><Ionicons name="location-outline" size={26} color="#ff4500" /></TouchableOpacity>
          </View>

        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!activeStory} animationType="fade" transparent={false} onRequestClose={() => setActiveStory(null)}>
        <View className="flex-1 bg-black">
          <View className="flex-row mt-14 px-3 gap-1">
            <View className="h-1 flex-1 bg-zinc-600 rounded-full overflow-hidden">
              <View className="h-full w-1/3 bg-white rounded-full" />
            </View>
          </View>
          <View className="flex-row items-center justify-between px-4 mt-4">
            <View className="flex-row items-center">
              <View className={`w-10 h-10 rounded-full border-2 items-center justify-center ${activeStory?.isGlobal ? 'border-red-500 bg-red-900/50' : 'border-[#ff4500] bg-zinc-800'}`}>
                <Text className="text-white font-bold">{activeStory?.communities?.name?.charAt(0) || 'C'}</Text>
              </View>
              <Text className="text-white font-bold ml-3 text-base">{activeStory?.communities?.name}</Text>
            </View>
            <TouchableOpacity onPress={() => setActiveStory(null)} className="p-2">
              <Ionicons name="close" size={28} color="white" />
            </TouchableOpacity>
          </View>
          <View className="flex-1 justify-center px-6">
            <Text className="text-white text-3xl font-black text-center leading-[42px]">{activeStory?.content}</Text>
            {activeStory?.poll_options && activeStory.poll_options.length > 0 && (
              <View className="mt-12 w-full">
                <Text className="text-zinc-400 text-center mb-4 uppercase text-xs font-bold tracking-widest">Enquete de Base</Text>
                {activeStory.poll_options.map((option: string, index: number) => (
                  <TouchableOpacity key={index} className="bg-zinc-800/80 py-4 px-6 rounded-2xl mb-3 border border-zinc-700">
                    <Text className="text-white text-center font-bold text-lg">{option}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {activeStory?.action_label && (
               <View className="mt-16 items-center w-full">
                 <TouchableOpacity className="bg-[#ff4500] py-4 w-full rounded-2xl flex-row items-center justify-center shadow-lg">
                   <Ionicons name="location-sharp" size={22} color="white" className="mr-2" />
                   <Text className="text-white font-black text-base uppercase tracking-widest">{activeStory.action_label}</Text>
                 </TouchableOpacity>
               </View>
            )}
          </View>
        </View>
      </Modal>

    </View>
  );
}