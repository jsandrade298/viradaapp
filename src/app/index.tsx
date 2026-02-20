import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase'; // Caminho correto para o Login (volta 1 pasta)

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signInWithEmail() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      Alert.alert('Erro no Acesso', error.message);
    } else {
      router.replace('/(tabs)');
    }
    setLoading(false);
  }

  return (
    <View className="flex-1 bg-[#1a1a1a] justify-center px-8">
      <View className="mb-10">
        <Text className="text-white text-5xl font-extrabold mb-2">Mobiliza</Text>
        <Text className="text-gray-400 text-base">Acesso restrito para convidados da organização.</Text>
      </View>

      <View className="space-y-5">
        <TextInput
          className="w-full bg-zinc-800 text-white px-5 py-4 rounded-xl text-base mb-4"
          placeholder="Seu e-mail de militante"
          placeholderTextColor="#9ca3af"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        
        <TextInput
          className="w-full bg-zinc-800 text-white px-5 py-4 rounded-xl text-base mb-8"
          placeholder="Sua senha"
          placeholderTextColor="#9ca3af"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity 
          className="w-full bg-[#ff4500] py-4 rounded-xl items-center shadow-lg"
          onPress={signInWithEmail}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text className="text-white font-bold text-lg uppercase tracking-wider">
              Entrar na Luta
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}