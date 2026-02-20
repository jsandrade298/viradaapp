import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

export default function RadarScreen() {
  // Coordenadas iniciais (Santo André / ABC Paulista)
  const initialRegion = {
    latitude: -23.6666,
    longitude: -46.5322,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  return (
    <View className="flex-1 bg-[#1a1a1a]">
      {/* Cabeçalho Flutuante sobre o Mapa */}
      <View className="absolute top-14 left-6 right-6 z-10 flex-row justify-between items-center bg-zinc-900/90 p-4 rounded-2xl border border-zinc-800 shadow-lg">
        <View>
          <Text className="text-white text-lg font-black tracking-wide">Radar de Mobilização</Text>
          <Text className="text-[#ff4500] text-xs font-bold">1 evento ativo na sua região</Text>
        </View>
      </View>

      {/* O Mapa Interativo */}
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        customMapStyle={darkMapStyle} // Aplica o visual noturno/chumbo
        showsUserLocation={true}
      >
        {/* Marcador de Exemplo (Onde o Check-in vai acontecer no futuro) */}
        <Marker
          coordinate={{ latitude: -23.6650, longitude: -46.5330 }}
          title="Ato na Câmara"
          description="Mobilização importante hoje. Clique para apoiar."
          pinColor="#ff4500" // Nosso laranja vibrante
        />
      </MapView>
      
      {/* Painel Inferior Flutuante (Resumo do Evento) */}
      <View className="absolute bottom-6 left-6 right-6 z-10 bg-zinc-900 p-5 rounded-3xl border border-zinc-800 shadow-2xl">
        <View className="flex-row items-center mb-2">
          <View className="w-3 h-3 rounded-full bg-[#ff4500] mr-2 animate-pulse" />
          <Text className="text-white font-bold text-base">Ato na Câmara Municipal</Text>
        </View>
        <Text className="text-gray-400 text-sm mb-4 leading-5">
          Precisamos lotar as galerias. O raio de check-in é de 200 metros do local.
        </Text>
        
        <View className="w-full bg-zinc-800 py-3 rounded-xl items-center border border-zinc-700 opacity-50">
          <Text className="text-gray-400 font-bold text-sm uppercase tracking-wider">
            Chegue mais perto para fazer Check-in
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    width: '100%',
    height: '100%',
  },
});

// Arquivo JSON padrão para deixar o mapa com o visual Dark Mode
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