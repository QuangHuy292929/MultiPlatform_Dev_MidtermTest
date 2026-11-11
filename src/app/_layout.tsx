import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F7F8FC' } }}>
        <Stack.Screen name="index" />
      </Stack>
    </ThemeProvider>
  );
}
