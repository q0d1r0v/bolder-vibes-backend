export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  framework: string;
  category: 'mobile' | 'fullstack';
  suggestedPrompts: string[];
  files: { path: string; content: string }[];
}

// ────────────────────────────────────────────────────────────
// Expo starter files — shared across all industry templates
// ────────────────────────────────────────────────────────────

// Expo SDK 54 baseline — matches the SDK that the latest public
// Expo Go binary on the Play Store / App Store targets. The actual
// minor versions of every `expo-*` package are re-pinned at build
// time by `expo install --fix` so they stay aligned with SDK 54's
// manifest even if we drift slightly here.
const EXPO_PACKAGE_JSON = JSON.stringify(
  {
    name: 'my-mobile-app',
    version: '1.0.0',
    main: 'expo/AppEntry.js',
    scripts: {
      start: 'expo start',
      android: 'expo start --android',
      ios: 'expo start --ios',
      web: 'expo start --web',
    },
    dependencies: {
      expo: '~54.0.0',
      '@expo/metro-runtime': '~6.1.0',
      'expo-status-bar': '~3.0.0',
      // Expo SDK 54 uses expo-font 14.x (despite @expo/vector-icons 15
      // being the right major). The peer dep on @expo/vector-icons is
      // `>=14.0.4`, so 14.1 satisfies it cleanly.
      'expo-font': '~14.1.0',
      react: '19.1.0',
      'react-native': '0.81.4',
      'react-dom': '19.1.0',
      'react-native-web': '~0.21.0',
      'react-native-safe-area-context': '~5.6.0',
      'react-native-screens': '~4.13.0',
      '@react-navigation/native': '^7.0.0',
      '@react-navigation/native-stack': '^7.0.0',
      '@react-navigation/bottom-tabs': '^7.0.0',
      '@expo/vector-icons': '~15.0.2',
      '@react-native-async-storage/async-storage': '2.2.0',
      zustand: '^5.0.0',
    },
    devDependencies: {
      '@babel/core': '^7.25.0',
      '@types/react': '~19.1.0',
      typescript: '^5.7.0',
    },
    // `expo.doctor.reactNativeDirectoryCheck.listUnknownPackages: false`
    // silences doctor's warning about packages it can't find in the RN
    // directory (e.g. `zustand`) — those are fine and don't affect the
    // build, but EAS treats the warning as a failure in non-interactive
    // mode.
    expo: {
      doctor: {
        reactNativeDirectoryCheck: {
          listUnknownPackages: false,
        },
      },
    },
    private: true,
  },
  null,
  2,
);

const EXPO_APP_JSON = JSON.stringify(
  {
    expo: {
      name: 'My App',
      slug: 'my-mobile-app',
      version: '1.0.0',
      orientation: 'portrait',
      icon: './assets/icon.png',
      userInterfaceStyle: 'light',
      newArchEnabled: true,
      splash: {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
      ios: { supportsTablet: true },
      android: {
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: '#ffffff',
        },
      },
      web: { bundler: 'metro' },
      platforms: ['ios', 'android', 'web'],
    },
  },
  null,
  2,
);

const EXPO_TSCONFIG = JSON.stringify(
  {
    extends: 'expo/tsconfig.base',
    compilerOptions: {
      strict: true,
      paths: { '@/*': ['./src/*'] },
    },
  },
  null,
  2,
);

const EXPO_BABEL_CONFIG = `module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`;

const EXPO_APP_TSX = `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Welcome to My App</Text>
          <Text style={styles.subtitle}>Start building your mobile app</Text>
        </View>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});
`;

const EXPO_STARTER_FILES: { path: string; content: string }[] = [
  { path: 'package.json', content: EXPO_PACKAGE_JSON },
  { path: 'app.json', content: EXPO_APP_JSON },
  { path: 'App.tsx', content: EXPO_APP_TSX },
  { path: 'tsconfig.json', content: EXPO_TSCONFIG },
  { path: 'babel.config.js', content: EXPO_BABEL_CONFIG },
];

// ────────────────────────────────────────────────────────────
// Industry Templates
// ────────────────────────────────────────────────────────────

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'ecommerce',
    name: 'E-Commerce',
    description: 'Online store, product catalog, shopping cart, payments',
    icon: 'ShoppingCart',
    color: '#8B5CF6',
    framework: 'expo',
    category: 'mobile',
    suggestedPrompts: [
      'Create a product listing screen with categories',
      'Add a shopping cart with checkout flow',
      'Build a product detail page with reviews',
    ],
    files: EXPO_STARTER_FILES,
  },
  {
    id: 'social',
    name: 'Social Network',
    description: 'Posts, profiles, messaging, followers, feed',
    icon: 'Users',
    color: '#3B82F6',
    framework: 'expo',
    category: 'mobile',
    suggestedPrompts: [
      'Create a social feed with posts and likes',
      'Build a user profile screen',
      'Add a messaging/chat feature',
    ],
    files: EXPO_STARTER_FILES,
  },
  {
    id: 'health',
    name: 'Health & Fitness',
    description: 'Workouts, diet tracking, health monitoring',
    icon: 'Heart',
    color: '#EF4444',
    framework: 'expo',
    category: 'mobile',
    suggestedPrompts: [
      'Create a workout tracker with exercises',
      'Build a calorie counter with meal logging',
      'Add a daily step counter dashboard',
    ],
    files: EXPO_STARTER_FILES,
  },
  {
    id: 'education',
    name: 'Education',
    description: 'Courses, quizzes, learning progress, flashcards',
    icon: 'GraduationCap',
    color: '#F59E0B',
    framework: 'expo',
    category: 'mobile',
    suggestedPrompts: [
      'Create a course catalog with lessons',
      'Build a quiz app with scoring',
      'Add flashcards with spaced repetition',
    ],
    files: EXPO_STARTER_FILES,
  },
  {
    id: 'food',
    name: 'Food & Delivery',
    description: 'Restaurants, menus, ordering, delivery tracking',
    icon: 'UtensilsCrossed',
    color: '#F97316',
    framework: 'expo',
    category: 'mobile',
    suggestedPrompts: [
      'Create a restaurant listing with menus',
      'Build an order placement screen',
      'Add a delivery tracking map',
    ],
    files: EXPO_STARTER_FILES,
  },
  {
    id: 'productivity',
    name: 'Productivity',
    description: 'Tasks, notes, calendar, reminders, to-do lists',
    icon: 'CheckSquare',
    color: '#22C55E',
    framework: 'expo',
    category: 'mobile',
    suggestedPrompts: [
      'Create a to-do list with categories',
      'Build a notes app with search',
      'Add a calendar with reminders',
    ],
    files: EXPO_STARTER_FILES,
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Budget tracking, expenses, transactions, reports',
    icon: 'Wallet',
    color: '#14B8A6',
    framework: 'expo',
    category: 'mobile',
    suggestedPrompts: [
      'Create an expense tracker with charts',
      'Build a budget planner with categories',
      'Add transaction history with filters',
    ],
    files: EXPO_STARTER_FILES,
  },
  {
    id: 'custom',
    name: 'Custom App',
    description: 'Start from scratch — build any mobile app you want',
    icon: 'Smartphone',
    color: '#6366F1',
    framework: 'expo',
    category: 'mobile',
    suggestedPrompts: [
      'Describe your app idea and I will build it',
      'Create a simple app with a few screens',
      'Build something unique',
    ],
    files: EXPO_STARTER_FILES,
  },
];
