import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Image, Modal } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

export default function RadarScreen() {
  const [activeTab, setActiveTab] = useState<'mapa' | 'agenda'>('mapa');
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  
  const [events, setEvents] = useState<any[]>([]);
  const [activeEvent, setActiveEvent] = useState<any>(null); 
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  // Nossos dois estados de relacionamento do usuário com o evento
  const [userIntentions, setUserIntentions] = useState<string[]>([]); 
  const [userCheckins, setUserCheckins] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  useEffect(() => {
    fetchEvents();
    startLocationTracking();
  }, []);

  useEffect(() => {
    if (location && activeEvent) {
      const dist = getDistanceFromLatLonInMeters(
        location.coords.latitude, location.coords.longitude,
        activeEvent.latitude, activeEvent.longitude
      );
      setDistance(dist);
    }
  }, [location, activeEvent]);

  async function fetchEvents() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUser(user);
      
      // Busca todos os registros do usuário na tabela de presença
      const { data: checkins } = await supabase
        .from('event_checkins')
        .select('event_id, status')
        .eq('user_id', user.id);
      
      if (checkins) {
        setUserIntentions(checkins.filter(c => c.status === 'VOU_PARTICIPAR').map(c => c.event_id));
        setUserCheckins(checkins.filter(c => c.status === 'ESTOU_NA_LUTA').map(c => c.event_id));
      }
    }

    const { data, error } = await supabase
      .from('events')
      .select(`
        *,
        communities (name),
        event_checkins (count)
      `)
      .gte('event_date', new Date().toISOString())
      .order('event_date', { ascending: true });

    if (data) {
      setEvents(data);
      if (data.length > 0) setActiveEvent(data[0]); 
    }
    setLoading(false);
  }

  async function startLocationTracking() {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
      (newLocation) => setLocation(newLocation)
    );
  }

  function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371e3; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
  }

  function formatEventDate(isoString: string) {
    const d = new Date(isoString);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const hora = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${mes} • ${hora}:${min}`;
  }

  // --- O CHECK-IN FÍSICO (MAPA) ---
  async function handleCheckin() {
    if (!currentUser || !activeEvent) return;
    setActionLoading(true);
    
    // O upsert converte o 'VOU_PARTICIPAR' para 'ESTOU_NA_LUTA' se a pessoa já tinha intenção
    await supabase.from('event_checkins').upsert({
      event_id: activeEvent.id,
      user_id: currentUser.id,
      status: 'ESTOU_NA_LUTA',
      checked_in_at: new Date().toISOString()
    });

    setActionLoading(false);
    setUserCheckins(prev => [...prev, activeEvent.id]);
    Alert.alert("A Luta é Nossa!", "Sua presença no território foi confirmada pela coordenação.");
    fetchEvents();
  }

  // --- A INTENÇÃO (AGENDA) ---
  async function handleParticipate(eventoParam: any) {
    if (!currentUser) return;
    setActionLoading(true);

    const isParticipating = userIntentions.includes(eventoParam.id);

    if (isParticipating) {
      await supabase.from('event_checkins')
        .delete()
        .eq('event_id', eventoParam.id)
        .eq('user_id', currentUser.id)
        .eq('status', 'VOU_PARTICIPAR');
      setUserIntentions(prev => prev.filter(id => id !== eventoParam.id));
    } else {
      await supabase.from('event_checkins').upsert({
        event_id: eventoParam.id,
        user_id: currentUser.id,
        status: 'VOU_PARTICIPAR'
      });
      setUserIntentions(prev => [...prev, eventoParam.id]);
    }

    setActionLoading(false);
    fetchEvents();
  }

  const isNear = distance !== null && activeEvent && distance <= activeEvent.radius_meters;
  const hasCheckedIn = activeEvent && userCheckins.includes(activeEvent.id);

  if (loading) {
    return (
      <View className="flex-1 bg-[#1a1a1a] justify-center items-center">
        <ActivityIndicator size="large" color="#ff4500" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#1a1a1a]">
      
      <View className="absolute top-14 left-6 right-6 z-20 bg-zinc-900 p-1.5 rounded-2xl border border-zinc-800 shadow-xl flex-row">
        <TouchableOpacity onPress={() => setActiveTab('mapa')} className={`flex-1 py-2.5 items-center rounded-xl flex-row justify-center ${activeTab === 'mapa' ? 'bg-zinc-800' : ''}`}>
          <Ionicons name="map" size={18} color={activeTab === 'mapa' ? '#ff4500' : '#9ca3af'} />
          <Text className={`font-bold ml-2 ${activeTab === 'mapa' ? 'text-white' : 'text-gray-400'}`}>Mapa</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveTab('agenda')} className={`flex-1 py-2.5 items-center rounded-xl flex-row justify-center ${activeTab === 'agenda' ? 'bg-zinc-800' : ''}`}>
          <Ionicons name="calendar" size={18} color={activeTab === 'agenda' ? '#ff4500' : '#9ca3af'} />
          <Text className={`font-bold ml-2 ${activeTab === 'agenda' ? 'text-white' : 'text-gray-400'}`}>Agenda</Text>
        </TouchableOpacity>
      </View>

      {/* TELA DE MAPA */}
      {activeTab === 'mapa' && activeEvent && (
        <View className="flex-1">
          <MapView
            style={styles.map}
            provider={PROVIDER_DEFAULT}
            initialRegion={{
              latitude: activeEvent.latitude,
              longitude: activeEvent.longitude,
              latitudeDelta: 0.015,
              longitudeDelta: 0.015,
            }}
            customMapStyle={darkMapStyle}
            showsUserLocation={true}
            mapPadding={{ top: 120, right: 10, bottom: 200, left: 10 }}
          >
            <Marker coordinate={{ latitude: activeEvent.latitude, longitude: activeEvent.longitude }} title={activeEvent.title} pinColor="#ff4500" />
          </MapView>
          
          <View className="absolute bottom-6 left-6 right-6 z-10 bg-zinc-900 p-5 rounded-3xl border border-zinc-800 shadow-2xl">
            <View className="flex-row items-center mb-2">
              <View className="w-3 h-3 rounded-full bg-[#ff4500] mr-2 animate-pulse" />
              <Text className="text-white font-bold text-base" numberOfLines={1}>{activeEvent.title}</Text>
            </View>
            <Text className="text-gray-400 text-sm mb-4 leading-5">
              {/* Mostra o Endereço no Mapa! */}
              {activeEvent.address || 'Endereço não informado'}
              {distance !== null && !hasCheckedIn && (
                <Text className="text-zinc-500 text-xs font-bold"> {'\n'}📍 A {Math.round(distance)} metros de distância.</Text>
              )}
            </Text>
            
            {/* Lógica do Botão do Mapa (Três Estados) */}
            {hasCheckedIn ? (
              <View className="w-full bg-emerald-900/40 py-3 rounded-xl flex-row items-center justify-center border border-emerald-500">
                <Ionicons name="checkmark-circle" size={20} color="#10b981" className="mr-2" />
                <Text className="text-emerald-500 font-bold text-sm uppercase tracking-wider">Você está na Luta!</Text>
              </View>
            ) : isNear ? (
              <TouchableOpacity onPress={handleCheckin} disabled={actionLoading} className="w-full bg-[#ff4500] py-3 rounded-xl flex-row items-center justify-center shadow-lg">
                {actionLoading ? <ActivityIndicator color="#ffffff" size="small" /> : (
                  <><Ionicons name="location-sharp" size={20} color="#ffffff" className="mr-2" /><Text className="text-white font-bold text-sm uppercase tracking-wider">Estou na Luta</Text></>
                )}
              </TouchableOpacity>
            ) : (
              <View className="w-full bg-zinc-800 py-3 rounded-xl items-center border border-zinc-700 opacity-50">
                <Text className="text-gray-400 font-bold text-sm uppercase tracking-wider">Chegue mais perto para o Check-in</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* TELA DE AGENDA */}
      {activeTab === 'agenda' && (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 130, paddingHorizontal: 20, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          <Text className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-4 ml-1">Próximos Eventos</Text>

          {events.map((evento) => {
            const confirmedCount = evento.event_checkins?.[0]?.count || 0;
            const progress = Math.min((confirmedCount / evento.volunteer_goal) * 100, 100);
            
            const isParticipating = userIntentions.includes(evento.id);
            const isCheckedIn = userCheckins.includes(evento.id); // Se ele já foi no evento

            return (
              <TouchableOpacity key={evento.id} activeOpacity={0.8} onPress={() => setSelectedEvent(evento)} className="bg-zinc-900 rounded-2xl mb-6 border border-zinc-800 overflow-hidden shadow-lg">
                <Image source={{ uri: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?q=80&w=500&auto=format&fit=crop' }} className="w-full h-32 opacity-80" resizeMode="cover" />
                
                <View className="p-5">
                  <View className="flex-row justify-between items-center mb-2">
                    <Text className="text-[#ff4500] text-xs font-bold uppercase">{evento.communities?.name}</Text>
                    <Text className="text-white font-bold bg-zinc-800 px-2 py-1 rounded text-xs">{formatEventDate(evento.event_date)}</Text>
                  </View>

                  <Text className="text-white text-xl font-black mb-1">{evento.title}</Text>
                  
                  <View className="flex-row items-center mb-5">
                    <Ionicons name="location-outline" size={16} color="#9ca3af" />
                    {/* Endereço real aqui também */}
                    <Text className="text-gray-400 text-sm ml-1" numberOfLines={1}>{evento.address || 'Local a definir'}</Text>
                  </View>

                  <View className="mb-5">
                    <View className="flex-row justify-between mb-1.5">
                      <Text className="text-gray-300 text-xs font-semibold">Mobilização</Text>
                      <Text className="text-gray-400 text-xs">{confirmedCount} de {evento.volunteer_goal} confirmados</Text>
                    </View>
                    <View className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <View className="h-full bg-[#ff4500] rounded-full" style={{ width: `${progress}%` }} />
                    </View>
                  </View>

                  {/* Se o cara já tiver feito check-in, o card também reflete isso */}
                  {isCheckedIn ? (
                    <View className="w-full bg-emerald-900/40 py-3 rounded-xl flex-row items-center justify-center border border-emerald-500">
                      <Ionicons name="checkmark-circle" size={16} color="#10b981" />
                      <Text className="text-emerald-500 font-bold text-xs uppercase tracking-widest ml-2">Presença Confirmada</Text>
                    </View>
                  ) : (
                    <TouchableOpacity 
                      onPress={() => handleParticipate(evento)}
                      disabled={actionLoading}
                      className={`w-full py-3 rounded-xl flex-row items-center justify-center border ${isParticipating ? 'bg-zinc-800 border-zinc-700' : 'bg-transparent border-[#ff4500]'}`}
                    >
                      <Ionicons name={isParticipating ? "checkmark-circle" : "hand-right-outline"} size={16} color={isParticipating ? "#10b981" : "#ff4500"} />
                      <Text className={`font-bold text-xs uppercase tracking-widest ml-2 ${isParticipating ? 'text-gray-300' : 'text-[#ff4500]'}`}>
                        {isParticipating ? "Intenção Confirmada" : "Vou Participar"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* MODAL ELÁSTICO E COM ENDEREÇO */}
      <Modal visible={!!selectedEvent} animationType="slide" transparent={true} onRequestClose={() => setSelectedEvent(null)}>
        <View className="flex-1 bg-black/80 justify-end">
          <View className="bg-zinc-900 rounded-t-3xl h-[85%] border-t border-zinc-700 overflow-hidden relative">
            
            <TouchableOpacity onPress={() => setSelectedEvent(null)} className="absolute top-4 right-4 z-20 bg-black/50 p-2 rounded-full">
              <Ionicons name="close" size={24} color="white" />
            </TouchableOpacity>

            <Image source={{ uri: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?q=80&w=500&auto=format&fit=crop' }} className="w-full h-48 opacity-90" resizeMode="cover" />
            
            <ScrollView 
              className="flex-1" 
              contentContainerStyle={{ padding: 24, paddingBottom: 120, flexGrow: 1 }} // flexGrow resolve a elasticidade em textos curtos!
              showsVerticalScrollIndicator={false}
              bounces={true} 
              alwaysBounceVertical={true} 
              overScrollMode="always"
            >
              <Text className="text-[#ff4500] text-sm font-bold uppercase mb-2">{selectedEvent?.communities?.name}</Text>
              <Text className="text-white text-3xl font-black mb-4">{selectedEvent?.title}</Text>
              
              <View className="flex-row items-center mb-3">
                <Ionicons name="calendar-outline" size={20} color="#9ca3af" />
                <Text className="text-gray-300 text-base ml-2">{selectedEvent ? formatEventDate(selectedEvent.event_date) : ''}</Text>
              </View>
              
              <View className="flex-row items-start mb-6">
                <Ionicons name="location-outline" size={20} color="#9ca3af" className="mt-1" />
                <Text className="text-gray-300 text-base ml-2 pr-6 leading-6">{selectedEvent?.address || 'Local a definir'}</Text>
              </View>

              <Text className="text-white text-lg font-bold mt-2 mb-2">Sobre o Evento</Text>
              <Text className="text-gray-400 text-base leading-7 mb-8 text-justify">
                {selectedEvent?.description}
              </Text>
            </ScrollView>

            <View className="absolute bottom-0 left-0 right-0 p-6 bg-zinc-900 border-t border-zinc-800">
              
              {userCheckins.includes(selectedEvent?.id) ? (
                 <View className="w-full bg-emerald-900/40 py-4 rounded-xl flex-row items-center justify-center border border-emerald-500 shadow-lg">
                    <Ionicons name="checkmark-circle" size={20} color="#10b981" className="mr-2" />
                    <Text className="text-emerald-500 font-bold text-base uppercase tracking-wider">Você está na Luta!</Text>
                 </View>
              ) : (
                <TouchableOpacity 
                  onPress={() => handleParticipate(selectedEvent)} 
                  disabled={actionLoading} 
                  className={`w-full py-4 rounded-xl flex-row items-center justify-center shadow-lg border ${userIntentions.includes(selectedEvent?.id) ? 'bg-zinc-900 border-red-500' : 'bg-[#ff4500] border-[#ff4500]'}`}
                >
                  {actionLoading ? <ActivityIndicator color="#ffffff" size="small" /> : (
                    <>
                      <Ionicons name={userIntentions.includes(selectedEvent?.id) ? "close-circle-outline" : "hand-right-outline"} size={20} color={userIntentions.includes(selectedEvent?.id) ? "#ef4444" : "#ffffff"} className="mr-2" />
                      <Text className={`font-bold text-base uppercase tracking-wider ${userIntentions.includes(selectedEvent?.id) ? 'text-red-500' : 'text-white'}`}>
                        {userIntentions.includes(selectedEvent?.id) ? "Retirar Intenção" : "Confirmar Intenção"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

            </View>
            
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({ map: { width: '100%', height: '100%' } });
const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];