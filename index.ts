import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { createElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import App from './App';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Expo Go or web may already control the native splash lifecycle.
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
function Root() {
  return createElement(SafeAreaProvider, null, createElement(App));
}

registerRootComponent(Root);
