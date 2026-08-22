module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated (transitive Abhängigkeit von expo-router /
    // react-native-screens) braucht sein Worklet-Plugin. Es muss das LETZTE
    // Plugin in der Liste bleiben.
    plugins: ['react-native-worklets/plugin'],
  };
};
