import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

export default function FeedScreen() {
  const [posts, setPosts] = useState<any[]>([]);
  const [megafone, setMegafone] = useState<any>(null);
  const [stories, setStories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFeed();
  }, []);

  async function fetchFeed() {
    // 1. Busca o Megafone Global
    const { data: megafoneData } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_global', true)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (megafoneData) setMegafone(megafoneData);

    // 2. Busca os Stories Locais (Comunidades)
    const { data: storiesData } = await supabase
      .from('announcements')
      .select('id, content, communities(name)')
      .eq('is_global', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (storiesData) setStories(storiesData);

    // 3. Busca os Posts do Feed
    const { data: feedPosts } = await supabase
      .from('posts')
      .select(`
        id,
        content,
        created_at,
        profiles (full_name),
        communities (name)
      `)
      .order('created_at', { ascending: false });
    if (feedPosts) setPosts(feedPosts);

    setLoading(false);
  }

  if (loading) {
    return (
      <View className="flex-1 bg-[#1a1a1a] justify-center items-center">
        <ActivityIndicator size="large" color="#ff4500" />
        <Text className="text-gray-400 mt-4 font-semibold">Atualizando a rede...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#1a1a1a]">
      {/* Cabeçalho */}
      <View className="pt-14 pb-4 px-6 flex-row justify-between items-center bg-[#1a1a1a] border-b border-zinc-800">
        <Text className="text-white text-2xl font-black tracking-wide">Mobiliza</Text>
        <TouchableOpacity>
          <Ionicons name="notifications-outline" size={24} color="white" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={() => (
          <View className="mb-6">
            <Text className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-4 ml-1">
              Radar de Ações
            </Text>
            
            {/* Carrossel Unificado de Stories */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
              
              {/* 1. O Megafone Global (Sempre em 1º com destaque) */}
              {megafone && (
                <TouchableOpacity className="items-center mr-6 ml-1 relative">
                  {/* Borda Vermelha de Alerta */}
                  <View className="w-[68px] h-[68px] rounded-full border-2 border-red-500 p-[2px] items-center justify-center mb-1">
                    <View className="flex-1 w-full h-full rounded-full bg-red-900/80 items-center justify-center">
                      <Ionicons name="megaphone" size={28} color="#ffffff" />
                    </View>
                  </View>
                  
                  {/* Etiqueta URGENTE (Estilo "AO VIVO" do Instagram) */}
                  <View className="absolute bottom-4 bg-red-600 px-2 py-0.5 rounded border border-[#1a1a1a]">
                    <Text className="text-white text-[9px] font-black uppercase tracking-wider">
                      Urgente
                    </Text>
                  </View>
                  
                  <Text className="text-red-400 text-xs text-center w-20 font-bold mt-1" numberOfLines={1}>
                    Coordenação
                  </Text>
                </TouchableOpacity>
              )}

              {/* 2. Stories Locais das Comunidades */}
              {stories.map(story => (
                <TouchableOpacity key={story.id} className="items-center mr-5 mt-1">
                  <View className="w-16 h-16 rounded-full border-2 border-[#ff4500] p-[2px] mb-1">
                    <View className="flex-1 rounded-full bg-zinc-800 items-center justify-center">
                      <Text className="text-white font-bold text-xl">
                        {story.communities?.name?.charAt(0) || 'C'}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-gray-300 text-xs text-center w-16" numberOfLines={1}>
                    {story.communities?.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        renderItem={({ item }) => (
          <View className="bg-zinc-900 rounded-xl p-5 mb-4 border border-zinc-800 shadow-sm">
            <View className="flex-row items-center mb-4">
              <View className="w-10 h-10 bg-zinc-700 rounded-full items-center justify-center">
                <Text className="text-white font-bold text-lg">
                  {item.profiles?.full_name?.charAt(0) || '?'}
                </Text>
              </View>
              <View className="ml-3">
                <Text className="text-white font-bold text-base">{item.profiles?.full_name}</Text>
                <Text className="text-[#ff4500] text-xs font-bold">{item.communities?.name}</Text>
              </View>
            </View>
            
            {/* Conteúdo do Post */}
            <Text className="text-gray-200 text-base leading-6 mb-4">
              {item.content}
            </Text>
            
            {/* Interações (Design Minimalista e Padronizado) */}
            <View className="flex-row items-center justify-between border-t border-zinc-800 pt-4 px-1">
              
              {/* Grupo da Esquerda (Apoiar, Comentar, Repercutir) */}
              <View className="flex-row items-center">
                
                {/* Apoiar */}
                <TouchableOpacity className="flex-row items-center mr-8">
                  <Ionicons name="flame-outline" size={22} color="#9ca3af" />
                  <Text className="text-gray-400 text-sm font-medium ml-1.5">12</Text>
                </TouchableOpacity>
                
                {/* Comentar */}
                <TouchableOpacity className="flex-row items-center mr-8">
                  <Ionicons name="chatbubble-outline" size={20} color="#9ca3af" />
                  <Text className="text-gray-400 text-sm font-medium ml-1.5">4</Text>
                </TouchableOpacity>
                
                {/* Repercutir */}
                <TouchableOpacity className="flex-row items-center">
                  <Ionicons name="repeat" size={22} color="#9ca3af" />
                  <Text className="text-gray-400 text-sm font-medium ml-1.5">2</Text>
                </TouchableOpacity>

              </View>
              
              {/* Grupo da Direita (Salvar) */}
              <TouchableOpacity>
                <Ionicons name="bookmark-outline" size={22} color="#9ca3af" />
              </TouchableOpacity>
              
            </View>
          </View>
        )}
      />
    </View>
  );
}