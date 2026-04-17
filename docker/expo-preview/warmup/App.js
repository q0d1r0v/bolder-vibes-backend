"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = App;
const react_1 = __importDefault(require("react"));
const react_native_1 = require("react-native");
const expo_status_bar_1 = require("expo-status-bar");
const react_native_safe_area_context_1 = require("react-native-safe-area-context");
const native_1 = require("@react-navigation/native");
const native_stack_1 = require("@react-navigation/native-stack");
const bottom_tabs_1 = require("@react-navigation/bottom-tabs");
const vector_icons_1 = require("@expo/vector-icons");
const async_storage_1 = __importDefault(require("@react-native-async-storage/async-storage"));
const zustand_1 = require("zustand");
const useStore = (0, zustand_1.create)(() => ({ count: 0 }));
const Stack = (0, native_stack_1.createNativeStackNavigator)();
const Tab = (0, bottom_tabs_1.createBottomTabNavigator)();
function InnerScreen() {
    const count = useStore((s) => s.count);
    void async_storage_1.default.getItem('warmup');
    return (<react_native_safe_area_context_1.SafeAreaView style={styles.safe}>
      <react_native_1.View style={styles.c}>
        <react_native_1.Text>warmup {count}</react_native_1.Text>
        <vector_icons_1.Ionicons name="home" size={16}/>
        <vector_icons_1.MaterialIcons name="menu" size={16}/>
        <vector_icons_1.FontAwesome name="star" size={16}/>
        <vector_icons_1.Feather name="user" size={16}/>
        <expo_status_bar_1.StatusBar style="auto"/>
      </react_native_1.View>
    </react_native_safe_area_context_1.SafeAreaView>);
}
function TabsRoot() {
    return (<Tab.Navigator>
      <Tab.Screen name="Home" component={InnerScreen}/>
      <Tab.Screen name="Profile" component={InnerScreen}/>
    </Tab.Navigator>);
}
function App() {
    return (<react_native_safe_area_context_1.SafeAreaProvider>
      <native_1.NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Root" component={TabsRoot} options={{ headerShown: false }}/>
        </Stack.Navigator>
      </native_1.NavigationContainer>
    </react_native_safe_area_context_1.SafeAreaProvider>);
}
const styles = react_native_1.StyleSheet.create({
    safe: { flex: 1 },
    c: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
//# sourceMappingURL=App.js.map