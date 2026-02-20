import 'react-native-url-polyfill/auto';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    // headerShown: false remove a barra superior branca padrão do celular
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}