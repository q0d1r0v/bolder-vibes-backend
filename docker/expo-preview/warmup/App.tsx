// Warmup entrypoint. Imports every heavy module that the Bolder Vibes
// starter ships so that `expo export` transforms and caches them all.
// Touch EVERY API we rely on (render the component, mount the navigator,
// instantiate the store) — Metro drops unreferenced transforms otherwise.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Ionicons,
  MaterialIcons,
  FontAwesome,
  Feather,
} from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

type StoreState = { count: number };
const useStore = create<StoreState>(() => ({ count: 0 }));

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function InnerScreen() {
  const count = useStore((s) => s.count);
  // Touch AsyncStorage once so its module graph is visited.
  void AsyncStorage.getItem('warmup');
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.c}>
        <Text>warmup {count}</Text>
        <Ionicons name="home" size={16} />
        <MaterialIcons name="menu" size={16} />
        <FontAwesome name="star" size={16} />
        <Feather name="user" size={16} />
        <StatusBar style="auto" />
      </View>
    </SafeAreaView>
  );
}

function TabsRoot() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={InnerScreen} />
      <Tab.Screen name="Profile" component={InnerScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="Root"
            component={TabsRoot}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  c: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
