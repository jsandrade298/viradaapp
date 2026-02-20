import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ 
      headerShown: false,
      tabBarStyle: { 
        backgroundColor: '#1a1a1a',
        borderTopColor: '#333',
      },
      tabBarActiveTintColor: '#ff4500',
      tabBarInactiveTintColor: '#9ca3af',
    }}>
      
      <Tabs.Screen 
        name="index" 
        options={{ 
          title: 'Feed',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-sharp" size={size} color={color} />
          )
        }} 
      />

      {/* A nossa nova aba do Radar */}
      <Tabs.Screen 
        name="radar" 
        options={{ 
          title: 'Radar',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-sharp" size={size} color={color} />
          )
        }} 
      />

    </Tabs>
  );
}