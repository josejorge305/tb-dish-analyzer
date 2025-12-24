import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  ImageBackground,
  LayoutAnimation,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { AnalyzeDishResponse, analyzeDish, fetchMenuWithRetry, fetchMenuFast, pollApifyJob } from '../api/api';
import { fetchPlaceDetails } from '../api/places';
import { useUserPrefs } from '../context/UserPrefsContext';
import { useMenuPrefetch } from '../context/MenuPrefetchContext';
import { buildDishViewModel } from './utils/dishViewModel';
import {
  COLORS as DESIGN_COLORS,
  SPACING,
  RADIUS,
} from '../components/dish';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const LAST_RESTAURANT_KEY = '@restaurant_ai_last_restaurant';

const BG = '#020617';
const TEAL = '#14b8a6';
const ORANGE = '#f97316';
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
const USER_SELECTED_ALLERGENS: string[] = []; // TODO: wire from user profile/preferences
const PREFETCH_ANALYSIS_LIMIT = 0;

// Design system colors - teal-only palette for severity (matching dish.tsx redesign)
const COLORS = {
  brandTeal: '#14b8a6',      // Primary teal
  brandTealLight: '#2dd4bf', // Lighter teal variant
  neutral: '#6b7280',        // Gray
  calories: '#f97316',       // Orange for calories only
  protein: '#3b82f6',        // Blue
  carbs: '#a855f7',          // Purple
  fat: '#eab308',            // Yellow
  cardBg: '#1e293b',         // Slate 800
  cardBorder: 'rgba(255,255,255,0.08)',
  textPrimary: '#ffffff',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  tagBg: 'rgba(30, 41, 59, 0.5)',
  tagBorder: '#475569',
};

// Loading status messages - cycle through these to keep users engaged
const LOADING_MESSAGES = [
  { icon: 'search-outline', text: 'Discovering menu items...', phase: 1 },
  { icon: 'restaurant-outline', text: 'Reading the menu...', phase: 1 },
  { icon: 'list-outline', text: 'Organizing menu sections...', phase: 2 },
  { icon: 'nutrition-outline', text: 'Preparing nutrition analysis...', phase: 2 },
  { icon: 'flask-outline', text: 'Setting up allergen detection...', phase: 3 },
  { icon: 'leaf-outline', text: 'Configuring FODMAP analysis...', phase: 3 },
  { icon: 'sparkles-outline', text: 'Almost ready...', phase: 4 },
];

// Fun facts to show while loading
const LOADING_TIPS = [
  'Tip: Tap any dish to see detailed allergen and nutrition info',
  'Did you know? We analyze ingredients for 14 major allergens',
  'Tip: Your allergen preferences are saved for personalized warnings',
  'Fun fact: FODMAP stands for Fermentable Oligosaccharides, Disaccharides, Monosaccharides, and Polyols',
  'Tip: Check the "Likely Recipe" to see estimated ingredients',
];

// Dish analysis loading messages
const ANALYSIS_LOADING_MESSAGES = [
  { icon: 'search-outline', text: 'Finding recipe match...' },
  { icon: 'list-outline', text: 'Identifying ingredients...' },
  { icon: 'warning-outline', text: 'Scanning for allergens...' },
  { icon: 'leaf-outline', text: 'Checking FODMAP levels...' },
  { icon: 'nutrition-outline', text: 'Calculating nutrition...' },
  { icon: 'fitness-outline', text: 'Analyzing body impact...' },
  { icon: 'sparkles-outline', text: 'Finalizing analysis...' },
];

// Inline dish analysis loading component
function DishAnalysisLoader({ dishName }: { dishName: string }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  // Pulsing animation
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Cycle through messages every 3 seconds
  useEffect(() => {
    const messageTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % ANALYSIS_LOADING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(messageTimer);
  }, []);

  // Track elapsed time
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const currentMessage = ANALYSIS_LOADING_MESSAGES[messageIndex];
  const showLongWait = elapsedSeconds > 20;

  return (
    <View style={analysisLoaderStyles.container}>
      {/* Loader row */}
      <View style={analysisLoaderStyles.loaderRow}>
        <View style={analysisLoaderStyles.spinnerWrapper}>
          <Animated.View
            style={[
              analysisLoaderStyles.spinnerGlow,
              { opacity: pulseAnim },
            ]}
          />
          <ActivityIndicator size="small" color={TEAL} />
        </View>
        <View style={analysisLoaderStyles.messageArea}>
          <View style={analysisLoaderStyles.messageRow}>
            <Ionicons
              name={currentMessage.icon as any}
              size={14}
              color={TEAL}
            />
            <Text style={analysisLoaderStyles.messageText}>
              {currentMessage.text}
            </Text>
          </View>
          {elapsedSeconds > 5 && (
            <Text style={analysisLoaderStyles.elapsedText}>
              {elapsedSeconds}s
            </Text>
          )}
        </View>
      </View>

      {/* Progress bar */}
      <View style={analysisLoaderStyles.progressBar}>
        <Animated.View
          style={[
            analysisLoaderStyles.progressFill,
            {
              width: `${Math.min((messageIndex + 1) / ANALYSIS_LOADING_MESSAGES.length * 100, 95)}%`,
            },
          ]}
        />
      </View>

      {/* Long wait message */}
      {showLongWait && (
        <Text style={analysisLoaderStyles.longWaitText}>
          This dish requires deeper analysis - hang tight!
        </Text>
      )}
    </View>
  );
}

// Styles for dish analysis loader
const analysisLoaderStyles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  spinnerWrapper: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  spinnerGlow: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(20, 184, 166, 0.3)',
  },
  messageArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  messageText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#e2e8f0',
  },
  elapsedText: {
    fontSize: 12,
    color: '#64748b',
  },
  progressBar: {
    height: 3,
    backgroundColor: '#1e293b',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: TEAL,
    borderRadius: 2,
  },
  longWaitText: {
    marginTop: 12,
    fontSize: 13,
    color: '#f59e0b',
    fontStyle: 'italic',
  },
});

// Animated loading screen component
function MenuLoadingScreen({
  restaurantName,
  restaurantAddress,
  heroImageUrl,
}: {
  restaurantName?: string;
  restaurantAddress?: string;
  heroImageUrl?: string;
}) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  // Pulsing glow animation
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Cycle through messages every 4 seconds
  useEffect(() => {
    const messageTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 4000);
    return () => clearInterval(messageTimer);
  }, []);

  // Cycle tips every 8 seconds
  useEffect(() => {
    const tipTimer = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % LOADING_TIPS.length);
    }, 8000);
    return () => clearInterval(tipTimer);
  }, []);

  // Track elapsed time
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const currentMessage = LOADING_MESSAGES[messageIndex];
  const currentPhase = currentMessage.phase;

  // Show longer wait message after 30 seconds
  const showLongWaitMessage = elapsedSeconds > 30;

  return (
    <View style={loadingStyles.container}>
      <SafeAreaView style={loadingStyles.safeArea}>
        {/* Restaurant Hero Card */}
        <View style={loadingStyles.heroCard}>
          {heroImageUrl ? (
            <ImageBackground
              source={{ uri: heroImageUrl }}
              style={loadingStyles.heroImage}
              imageStyle={{ borderRadius: 16 }}
            >
              <View style={loadingStyles.heroOverlay}>
                <Text style={loadingStyles.heroName} numberOfLines={2}>
                  {restaurantName || 'Loading restaurant...'}
                </Text>
                {restaurantAddress ? (
                  <Text style={loadingStyles.heroAddress} numberOfLines={1}>
                    {restaurantAddress}
                  </Text>
                ) : null}
              </View>
            </ImageBackground>
          ) : (
            <View style={loadingStyles.heroPlaceholder}>
              <Ionicons name="restaurant" size={28} color={TEAL} />
              <Text style={loadingStyles.heroNameNoImage} numberOfLines={2}>
                {restaurantName || 'Loading restaurant...'}
              </Text>
              {restaurantAddress ? (
                <Text style={loadingStyles.heroAddressNoImage} numberOfLines={1}>
                  {restaurantAddress}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {/* Main loading area */}
        <View style={loadingStyles.mainContent}>
          {/* Clean loader with pulsing glow */}
          <View style={loadingStyles.loaderWrapper}>
            <Animated.View
              style={[
                loadingStyles.loaderGlow,
                { opacity: pulseAnim },
              ]}
            />
            <ActivityIndicator size="large" color={TEAL} />
          </View>

          {/* Status message */}
          <View style={loadingStyles.messageContainer}>
            <Ionicons
              name={currentMessage.icon as any}
              size={18}
              color={TEAL}
            />
            <Text style={loadingStyles.messageText}>{currentMessage.text}</Text>
          </View>

          {/* Progress dots */}
          <View style={loadingStyles.progressRow}>
            {[1, 2, 3, 4].map((phase) => (
              <View
                key={phase}
                style={[
                  loadingStyles.progressDot,
                  phase <= currentPhase && loadingStyles.progressDotActive,
                ]}
              />
            ))}
          </View>

          {/* Phase labels */}
          <View style={loadingStyles.phaseLabels}>
            <Text style={[loadingStyles.phaseLabel, currentPhase >= 1 && loadingStyles.phaseLabelActive]}>
              Discover
            </Text>
            <Text style={[loadingStyles.phaseLabel, currentPhase >= 2 && loadingStyles.phaseLabelActive]}>
              Organize
            </Text>
            <Text style={[loadingStyles.phaseLabel, currentPhase >= 3 && loadingStyles.phaseLabelActive]}>
              Analyze
            </Text>
            <Text style={[loadingStyles.phaseLabel, currentPhase >= 4 && loadingStyles.phaseLabelActive]}>
              Ready
            </Text>
          </View>
        </View>

        {/* Bottom section */}
        <View style={loadingStyles.bottomSection}>
          {/* Info box */}
          <View style={loadingStyles.infoBox}>
            <View style={loadingStyles.infoHeader}>
              <Ionicons name="time-outline" size={18} color={TEAL} />
              <Text style={loadingStyles.infoTitle}>One-time setup</Text>
            </View>
            <Text style={loadingStyles.infoText}>
              We're preparing this menu for the first time. Future visits will load instantly!
            </Text>
            {showLongWaitMessage ? (
              <Text style={loadingStyles.longWaitText}>
                This menu has a lot of items - hang tight, we're almost there!
              </Text>
            ) : null}
          </View>

          {/* Tip */}
          <View style={loadingStyles.tipBox}>
            <Ionicons name="bulb-outline" size={16} color="#facc15" />
            <Text style={loadingStyles.tipText}>{LOADING_TIPS[tipIndex]}</Text>
          </View>

          {/* Elapsed time */}
          {elapsedSeconds > 10 ? (
            <Text style={loadingStyles.elapsedTime}>{elapsedSeconds}s</Text>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

// Separate StyleSheet for loading screen to avoid conflicts
const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  safeArea: {
    flex: 1,
  },
  // Hero card styles
  heroCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 16,
  },
  heroImage: {
    height: 160,
    justifyContent: 'flex-end',
    borderRadius: 16,
    overflow: 'hidden',
  },
  heroOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  heroName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
  },
  heroAddress: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 4,
  },
  heroPlaceholder: {
    height: 120,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  heroNameNoImage: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 12,
    textAlign: 'center',
  },
  heroAddressNoImage: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
  // Main content
  mainContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  loaderWrapper: {
    width: 70,
    height: 70,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  loaderGlow: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(20, 184, 166, 0.2)',
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    gap: 10,
    paddingHorizontal: 16,
  },
  messageText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    flexShrink: 1,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '60%',
    marginBottom: 10,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#374151',
  },
  progressDotActive: {
    backgroundColor: '#14b8a6',
  },
  phaseLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '100%',
    paddingHorizontal: 8,
  },
  phaseLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  phaseLabelActive: {
    color: '#14b8a6',
  },
  bottomSection: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 16,
  },
  infoBox: {
    backgroundColor: 'rgba(20, 184, 166, 0.1)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#14b8a6',
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#9ca3af',
  },
  longWaitText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: '#f59e0b',
    fontStyle: 'italic',
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(250, 204, 21, 0.08)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#d1d5db',
  },
  elapsedTime: {
    fontSize: 12,
    color: '#4b5563',
    textAlign: 'center',
  },
});

// Get allergen pill color - teal-only design (all allergens use same teal styling)
const getAllergenPillColors = (_present: string, _isUserAllergen: boolean) => {
  // Teal-only design: all allergens use the same styling regardless of severity
  return {
    bg: 'rgba(20, 184, 166, 0.15)',
    border: COLORS.brandTeal,
    text: COLORS.brandTealLight,
  };
};

const getSeverityChipStyle = (severity: string) => {
  const s = (severity || '').toLowerCase();
  if (s.includes('generally safe') || s === 'safe') {
    return { backgroundColor: '#16a34a' };
  }
  if (s.includes('caution')) {
    return { backgroundColor: '#f59e0b' };
  }
  if (s.includes('avoid') || s === 'unsafe') {
    return { backgroundColor: '#ef4444' };
  }
  return { backgroundColor: '#4b5563' };
};

const getFodmapLevelBorderColor = (level?: string | null) => {
  const s = (level || '').toLowerCase();

  if (s === 'high') {
    return 'rgba(248, 113, 113, 0.9)';
  }
  if (s === 'medium') {
    return 'rgba(250, 204, 21, 0.9)';
  }
  if (s === 'low') {
    return 'rgba(34, 197, 94, 0.9)';
  }

  return '#4b5563';
};

type MenuResponse = {
  restaurant?: {
    id?: string | number;
    name?: string;
    address?: string;
    imageUrl?: string | null;
    imageRef?: string | null;
  };
  sections?: Array<{
    id?: string | number;
    name?: string;
    items?: Array<MenuItem>;
  }>;
};

type MenuItem = {
  id?: string | number;
  name?: string;
  description?: string;
  menuDescription?: string;
  subtitle?: string;
  shortDescription?: string;
  rawDescription?: string;
  priceText?: string;
  restaurantCalories?: number | null;
  imageUrl?: string | null;
  [key: string]: any;
};

function buildPhotoUrl(photoRef?: string | null) {
  if (!photoRef) return null;
  const params = new URLSearchParams({
    maxwidth: '1200',
    photoreference: photoRef,
    key: GOOGLE_API_KEY || '',
  });
  return `https://maps.googleapis.com/maps/api/place/photo?${params.toString()}`;
}

export default function RestaurantScreen() {
  const router = useRouter();
  const { placeId, restaurantName, address, lat, lng } = useLocalSearchParams();
  const { selectedAllergens } = useUserPrefs();
  const { getPrefetchedMenu, isMenuReady, getPrefetchStatus } = useMenuPrefetch();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const itemLayouts = useRef<Record<string, number>>({});
  const lastViewedItemId = useRef<string | null>(null);
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [restaurant, setRestaurant] = useState<MenuResponse['restaurant'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [analysisByItemId, setAnalysisByItemId] = useState<
    Record<string, AnalyzeDishResponse | null>
  >({});
  const [analysisLoadingByItemId, setAnalysisLoadingByItemId] = useState<Record<string, boolean>>(
    {}
  );
  const [googlePhotoRef, setGooglePhotoRef] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState('');

  const placeIdValue = Array.isArray(placeId) ? placeId[0] : placeId;
  const restaurantNameValue = Array.isArray(restaurantName) ? restaurantName[0] : restaurantName;
  const addressValue = Array.isArray(address) ? address[0] : address;
  const latValueRaw = Array.isArray(lat) ? lat[0] : lat;
  const lngValueRaw = Array.isArray(lng) ? lng[0] : lng;

  // keep as strings for now (backend will parse to numbers)
  const latValue = latValueRaw ?? undefined;
  const lngValue = lngValueRaw ?? undefined;

  useEffect(() => {
    async function loadMenu() {
      setError(null);
      setLoading(true);
      try {
        let data: any = null;

        // FAST PATH: Use fetchMenuFast first - it's the fastest (~10-30s)
        const searchAddress = addressValue || restaurantNameValue || '';
        if (restaurantNameValue && searchAddress) {
          console.log('[RestaurantScreen] Using fetchMenuFast (FAST PATH) with:', restaurantNameValue, searchAddress);
          data = await fetchMenuFast(restaurantNameValue, searchAddress, 50);
        }

        // Fall back to fetchMenuWithRetry only if fast method fails
        if ((!data || !data.ok) && placeIdValue) {
          console.log('[RestaurantScreen] fetchMenuFast failed, using fetchMenuWithRetry fallback');
          data = await fetchMenuWithRetry(placeIdValue);
        }

        console.log('MENU RAW DATA:', JSON.stringify(data, null, 2).slice(0, 500));
        const normalizedSections = Array.isArray((data as any)?.sections)
          ? (data as any).sections.map((section: any) => ({
              ...section,
              items: Array.isArray(section?.items)
                ? section.items.map((item: any) => ({
                    ...item,
                    description: item?.description ?? item?.menuDescription ?? '',
                    menuDescription: item?.menuDescription ?? item?.description ?? '',
                    imageUrl: item?.imageUrl ?? null,
                  }))
                : [],
            }))
          : [];

        console.log('MENU NORMALIZED SECTIONS LENGTH:', normalizedSections.length);
        setMenu({
          ...(data as any),
          sections: normalizedSections,
        });
        setRestaurant((data as any)?.restaurant ?? null);
      } catch (e: any) {
        console.log('MENU ERROR:', e);
        setError("We couldn't load this menu right now. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    if (placeIdValue) {
      loadMenu();
    } else {
      setError("We couldn't load this menu right now. Please try again.");
      setLoading(false);
    }
  }, [placeIdValue, restaurantNameValue, addressValue, latValue, lngValue, getPrefetchedMenu, getPrefetchStatus]);

  // Fetch Google Places photo reference for restaurant hero image
  useEffect(() => {
    async function fetchGooglePhoto() {
      if (!placeIdValue) return;
      try {
        console.log('[RestaurantScreen] Fetching Google photo for placeId:', placeIdValue);
        const details = await fetchPlaceDetails(placeIdValue);
        if (details.photoRef) {
          console.log('[RestaurantScreen] Got Google photo ref:', details.photoRef.slice(0, 50) + '...');
          setGooglePhotoRef(details.photoRef);
        }
      } catch (e: any) {
        console.log('[RestaurantScreen] Failed to fetch Google photo:', e?.message);
        // Non-critical - hero image will fall back to item image or no image
      }
    }
    fetchGooglePhoto();
  }, [placeIdValue]);

  // Save restaurant to cache for the Restaurant tab
  useEffect(() => {
    async function saveToCache() {
      if (!placeIdValue || !restaurantNameValue) return;
      try {
        const latStr = latValue as string | undefined;
        const lngStr = lngValue as string | undefined;
        const cachedRestaurant = {
          placeId: placeIdValue,
          name: restaurantNameValue,
          address: addressValue || '',
          lat: latStr ? parseFloat(latStr) : undefined,
          lng: lngStr ? parseFloat(lngStr) : undefined,
          visitedAt: Date.now(),
        };
        await AsyncStorage.setItem(LAST_RESTAURANT_KEY, JSON.stringify(cachedRestaurant));
        console.log('[RestaurantScreen] Saved restaurant to cache:', restaurantNameValue);
      } catch (e) {
        console.log('[RestaurantScreen] Failed to save restaurant to cache:', e);
      }
    }
    saveToCache();
  }, [placeIdValue, restaurantNameValue, addressValue, latValue, lngValue]);

  const runAnalysisForItem = async ({
    itemId,
    item,
    sectionName,
    descriptionText,
  }: {
    itemId: string;
    item: any;
    sectionName?: string;
    descriptionText: string;
  }): Promise<AnalyzeDishResponse | null> => {
    setAnalysisLoadingByItemId((prev) => ({ ...prev, [itemId]: true }));

    try {
      const result = await analyzeDish({
        dishName: item?.name,
        restaurantName: restaurant?.name || restaurantNameValue || null,
        // Send both menuDescription and description so the backend can rely on either
        menuDescription: descriptionText,
        description: descriptionText,
        menuSection: sectionName || '',
        priceText: item?.priceText || '',
        placeId: placeIdValue || null,
        source: 'edamam_recipe_card',
        restaurantCalories: item?.restaurantCalories,
        imageUrl: item?.imageUrl ?? null,
        fullRecipe: true,
      });

      setAnalysisByItemId((prev) => ({
        ...prev,
        [itemId]: result,
      }));
      return result;
    } catch (err) {
      console.error('Error calling analyzeDish', err);
      const errorResult = {
        ok: false,
        error: 'Analysis failed',
      } as AnalyzeDishResponse;
      setAnalysisByItemId((prev) => ({
        ...prev,
        [itemId]: errorResult,
      }));
      return errorResult;
    } finally {
      setAnalysisLoadingByItemId((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  useEffect(() => {
    if (PREFETCH_ANALYSIS_LIMIT <= 0) return;
    if (!menu || !menu.sections || menu.sections.length === 0) return;

    const itemsToPrefetch: {
      itemId: string;
      item: any;
      sectionName: string;
      descriptionText: string;
    }[] = [];

    for (const section of menu.sections) {
      const sectionName = section.name || '';
      const items = Array.isArray(section.items) ? section.items : [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const itemId = String(item?.id ?? item?.name ?? `${section.id}-${index}`);

        if (itemsToPrefetch.length >= PREFETCH_ANALYSIS_LIMIT) break;

        const descriptionText =
          item?.menuDescription ??
          item?.description ??
          item?.subtitle ??
          item?.shortDescription ??
          item?.rawDescription ??
          '';

        itemsToPrefetch.push({
          itemId,
          item,
          sectionName,
          descriptionText,
        });
      }
      if (itemsToPrefetch.length >= PREFETCH_ANALYSIS_LIMIT) break;
    }

    if (!itemsToPrefetch.length) return;

    // Fire analysis in the background for items that don't already have it
    itemsToPrefetch.forEach(({ itemId, item, sectionName, descriptionText }) => {
      if (analysisByItemId[itemId] || analysisLoadingByItemId[itemId]) {
        return;
      }
      runAnalysisForItem({
        itemId,
        item,
        sectionName,
        descriptionText,
      });
    });
  }, [menu, analysisByItemId, analysisLoadingByItemId]);

  // Scroll to last viewed item when returning from recipe page
  useFocusEffect(
    useCallback(() => {
      if (lastViewedItemId.current && itemLayouts.current[lastViewedItemId.current] !== undefined) {
        // Small delay to ensure layout is ready
        setTimeout(() => {
          const yOffset = itemLayouts.current[lastViewedItemId.current!];
          scrollViewRef.current?.scrollTo({ y: yOffset - 100, animated: true });
        }, 100);
      }
    }, [])
  );

  // Navigate to recipe page (when dish is already analyzed)
  const navigateToRecipe = (itemId: string, item: any, analysis: AnalyzeDishResponse) => {
    lastViewedItemId.current = itemId;
    const recipeImageUrl = item?.imageUrl || analysis?.recipe_image || '';
    router.push({
      pathname: '/likely-recipe',
      params: {
        dishName: item?.name || 'Unknown Dish',
        imageUrl: recipeImageUrl,
        likelyRecipe: analysis?.likely_recipe
          ? JSON.stringify(analysis.likely_recipe)
          : '',
        fullRecipe: analysis?.full_recipe
          ? JSON.stringify(analysis.full_recipe)
          : '',
        nutrition: analysis?.nutrition_summary
          ? JSON.stringify(analysis.nutrition_summary)
          : '',
        allergens: analysis?.allergen_flags
          ? JSON.stringify(analysis.allergen_flags)
          : '[]',
        fodmap: analysis?.fodmap_flags
          ? JSON.stringify(analysis.fodmap_flags)
          : '',
        nutritionSource: analysis?.nutrition_source || '',
      },
    });
  };

  // Handle "Show Analysis" button press
  const handleShowAnalysis = async (itemId: string, item: any, sectionName?: string) => {
    if (!itemId) return;

    const existingAnalysis = analysisByItemId[itemId];
    const isLoading = analysisLoadingByItemId[itemId];

    // If already analyzed successfully, navigate to recipe
    if (existingAnalysis && existingAnalysis.ok) {
      navigateToRecipe(itemId, item, existingAnalysis);
      return;
    }

    // If already loading, do nothing
    if (isLoading) return;

    // Start analysis and expand to show loader
    const descriptionText =
      item?.menuDescription ??
      item?.description ??
      item?.subtitle ??
      item?.shortDescription ??
      item?.rawDescription ??
      '';

    setExpandedItemId(itemId);
    const result = await runAnalysisForItem({
      itemId,
      item,
      sectionName,
      descriptionText,
    });

    // After analysis completes, navigate to recipe if successful
    if (result && result.ok) {
      setExpandedItemId(null); // Collapse the loader
      navigateToRecipe(itemId, item, result);
    }
  };

  // Hero image priority: Google photo ref (fetched from place details) > menu API imageRef > menu API imageUrl
  const heroUrl = buildPhotoUrl(googlePhotoRef) || buildPhotoUrl(restaurant?.imageRef) || restaurant?.imageUrl || undefined;

  // Filter menu sections/items based on search query
  const filteredSections = useMemo(() => {
    if (!menuSearch.trim()) return menu?.sections || [];
    const query = menuSearch.toLowerCase();
    return (menu?.sections || [])
      .map((section) => ({
        ...section,
        items: section.items?.filter(
          (item: any) =>
            item.name?.toLowerCase().includes(query) ||
            item.description?.toLowerCase().includes(query)
        ),
      }))
      .filter((section) => section.items && section.items.length > 0);
  }, [menu?.sections, menuSearch]);

  if (loading) {
    // Compute early hero URL from available sources (googlePhotoRef may be set from a parallel fetch)
    const earlyHeroUrl = buildPhotoUrl(googlePhotoRef) || buildPhotoUrl(restaurant?.imageRef) || restaurant?.imageUrl || undefined;
    return (
      <MenuLoadingScreen
        restaurantName={restaurantNameValue || undefined}
        restaurantAddress={addressValue || undefined}
        heroImageUrl={earlyHeroUrl}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!menu?.sections || menu.sections.length === 0) {
    const src = (menu as any)?.source || 'unknown';
    const backendError = (menu as any)?.error || (menu as any)?.uberDebug?.error || null;

    console.log('MENU EMPTY SECTIONS DEBUG:', {
      source: src,
      backendError,
      ok: (menu as any)?.ok,
    });

    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>
          {backendError
            ? `We couldn’t load this menu (${src}): ${backendError}`
            : 'No menu found for this restaurant.'}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <ScrollView ref={scrollViewRef} contentContainerStyle={styles.content}>
          <TouchableOpacity style={styles.backRow} onPress={() => router.push('/')}>
            <Text style={styles.backText}>← Back to home</Text>
          </TouchableOpacity>

          {restaurant && (
            <View style={{ marginTop: 12, marginBottom: 8, marginHorizontal: -16 }}>
              <View
                style={{
                  overflow: 'hidden',
                }}
              >
                {heroUrl ? (
                  <ImageBackground
                    source={{ uri: heroUrl }}
                    style={{ height: 220, justifyContent: 'flex-end' }}
                  >
                    <View
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 16,
                        backgroundColor: 'rgba(0,0,0,0.35)',
                      }}
                    >
                      <Text
                        style={{
                          color: 'white',
                          fontSize: 24,
                          fontWeight: '700',
                        }}
                      >
                        {restaurant.name || restaurantNameValue || menu.restaurant?.name}
                      </Text>
                      <Text
                        style={{
                          color: '#f0f0f0',
                          fontSize: 14,
                          marginTop: 4,
                        }}
                        numberOfLines={1}
                      >
                        {restaurant.address || addressValue || menu.restaurant?.address}
                      </Text>
                    </View>
                  </ImageBackground>
                ) : (
                  <View style={{ padding: 16 }}>
                    <Text style={{ fontSize: 24, fontWeight: '700', color: '#ffffff' }}>
                      {restaurant.name || restaurantNameValue || menu.restaurant?.name}
                    </Text>
                    <Text style={{ fontSize: 14, color: '#666', marginTop: 4 }}>
                      {restaurant.address || addressValue || menu.restaurant?.address}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Menu Search Bar */}
          <View style={styles.menuSearchContainer}>
            <Ionicons name="search" size={18} color="#666" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.menuSearchInput}
              placeholder="Search menu items..."
              placeholderTextColor="#666"
              value={menuSearch}
              onChangeText={setMenuSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {menuSearch ? (
              <TouchableOpacity onPress={() => setMenuSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close-circle" size={18} color="#666" />
              </TouchableOpacity>
            ) : null}
          </View>

          {menuSearch && filteredSections.length === 0 && (
            <Text style={styles.noResultsText}>No items found for "{menuSearch}"</Text>
          )}

          {filteredSections.map((section) => (
            <View key={section.id || section.name} style={{ marginTop: 16 }}>
              {section.name ? <Text style={styles.sectionTitle}>{section.name}</Text> : null}

              {section.items?.map((item: any, index: number) => {
                const itemId = String(item?.id ?? item?.name ?? `${section.id}-${index}`);
                const isExpanded = expandedItemId === itemId;

                const analysis = analysisByItemId[itemId];
                const isAnalysisLoading = !!analysisLoadingByItemId[itemId];
                const viewModel =
                  analysis && analysis.ok ? buildDishViewModel(analysis, selectedAllergens) : null;
                const organLines = viewModel?.organLines || [];

                const organOverallLevel: 'high' | 'medium' | 'low' | null = organLines.length
                  ? organLines.some((l: any) => l.severity === 'high')
                    ? 'high'
                    : organLines.some((l: any) => l.severity === 'medium')
                    ? 'medium'
                    : 'low'
                  : null;

                const organSummary: string | null = (() => {
                  if (!organLines || organLines.length === 0) {
                    return null;
                  }

                  // Build comprehensive summary from all organ sentences
                  // Filter to organs with non-neutral severity or meaningful sentences
                  const withSentences = organLines.filter(
                    (l: any) => l.sentence && l.sentence.length > 20 && l.severity !== 'neutral'
                  );

                  if (withSentences.length === 0) {
                    return 'Overall low organ impact; most organs stay neutral or mildly supported by this plate.';
                  }

                  // Prioritize high/medium, then take some low
                  const highMed = withSentences.filter(
                    (l: any) => l.severity === 'high' || l.severity === 'medium'
                  );
                  const low = withSentences.filter((l: any) => l.severity === 'low');

                  // Take all high/medium + up to 2 low, max 5 total
                  const selected = [...highMed, ...low.slice(0, Math.max(0, 5 - highMed.length))].slice(0, 5);

                  // Combine sentences into a paragraph
                  const paragraph = selected
                    .map((l: any) => {
                      const s = (l.sentence || '').trim().replace(/\.+$/, '');
                      return s + '.';
                    })
                    .join(' ');

                  return paragraph || 'Overall low organ impact; most organs stay neutral or mildly supported by this plate.';
                })();

                const totalCaloriesForPlate =
                  viewModel?.nutrition && typeof viewModel.nutrition.calories === 'number'
                    ? Math.round(viewModel.nutrition.calories)
                    : null;
                const descriptionText =
                  item?.menuDescription ??
                  item?.description ??
                  item?.subtitle ??
                  item?.shortDescription ??
                  item?.rawDescription ??
                  '';

                if (item?.name && item.name.toLowerCase().includes('egg mcmuffin')) {
                  console.log('DEBUG MENU ITEM – Egg McMuffin', item, Object.keys(item || {}));
                }

                return (
                  <View
                    key={itemId}
                    style={styles.card}
                    onLayout={(e) => {
                      itemLayouts.current[itemId] = e.nativeEvent.layout.y;
                    }}
                  >
                    {item?.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.itemImage} />
                    ) : null}

                    <Text style={styles.itemName} numberOfLines={2}>
                      {item?.name}
                    </Text>

                    {descriptionText ? (
                      <Text style={styles.dishDescription} numberOfLines={3}>
                        {descriptionText}
                      </Text>
                    ) : null}

                    {/* Allergen & FODMAP pills - shown when dish has been analyzed */}
                    {viewModel && (
                      <View style={styles.inlineWarningBadges}>
                        {/* Allergen badges - teal styling */}
                        {viewModel.allergens.filter(a => a.present === 'yes').slice(0, 4).map((allergen, idx) => (
                          <View
                            key={`inline-allergen-${idx}`}
                            style={styles.inlineBadgeTeal}
                          >
                            <Text style={styles.inlineBadgeTextTeal}>{allergen.name}</Text>
                          </View>
                        ))}
                        {/* FODMAP badge - teal styling */}
                        {viewModel.fodmapLevel && (viewModel.fodmapLevel === 'high' || viewModel.fodmapLevel === 'medium') && (
                          <View style={styles.inlineBadgeTeal}>
                            <Text style={styles.inlineBadgeTextTeal}>
                              {viewModel.fodmapLevel === 'high' ? 'High' : 'Mod'} FODMAP
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    <TouchableOpacity
                      onPress={() => handleShowAnalysis(String(itemId), item, section.name || '')}
                    >
                      <Text style={styles.showMoreText}>
                        {isAnalysisLoading ? 'Analyzing…' : 'Show analysis'}
                      </Text>
                    </TouchableOpacity>

                    {/* Show loader only when analysis is in progress */}
                    {isExpanded && isAnalysisLoading && (
                      <View style={styles.expandedVerdictContainer}>
                        <DishAnalysisLoader dishName={item?.name || 'this dish'} />
                      </View>
                    )}

                    {/* Show error message if analysis failed */}
                    {isExpanded && !isAnalysisLoading && analysis && !analysis.ok && (
                      <View style={styles.expandedVerdictContainer}>
                        <Text style={styles.verdictBodyText}>
                          Analysis failed. Tap "Show analysis" to try again.
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>

        {/* Bottom Navigation */}
        <View style={styles.bottomNav}>
          <TouchableOpacity style={styles.bottomNavItem} onPress={() => router.push('/')}>
            <Ionicons name="home" size={22} color="#ffffff" />
            <Text style={styles.bottomNavText}>Home</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.bottomNavItem}
            onPress={() => router.push('/(tabs)/explore')}
          >
            <Ionicons name="bar-chart-outline" size={22} color="#ffffff" />
            <Text style={styles.bottomNavText}>Tracker</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomNavItem} onPress={() => router.push('/profile')}>
            <Ionicons name="person-circle" size={22} color="#ffffff" />
            <Text style={styles.bottomNavText}>Profile</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 140,
  },
  backRow: {
    marginBottom: 12,
  },
  backText: {
    fontSize: 14,
    fontWeight: '700',
    color: TEAL,
  },
  headerName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
  },
  headerAddress: {
    marginTop: 4,
    fontSize: 14,
    color: '#9ca3af',
  },
  sectionTitle: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  card: {
    backgroundColor: '#020819',
    borderRadius: 24,
    padding: 16,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  imageWrapper: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 12,
  },
  itemImage: {
    width: '100%',
    height: 240,
    resizeMode: 'cover',
  },
  heartButton: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemName: {
    fontSize: 22, // xl - dish names
    fontWeight: '700',
    color: '#ffffff',
    lineHeight: 28,
  },
  itemPrice: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '600',
    color: '#d1d5db',
  },
  dishDescription: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.75)',
  },
  healthInsightCallout: {
    flexDirection: 'row',
    backgroundColor: 'rgba(250, 204, 21, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#facc15',
  },
  healthInsightIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  healthInsightText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.85)',
  },
  inlineWarningBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  inlineBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  inlineBadgeWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  inlineBadgeDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: 'rgba(239, 68, 68, 0.6)',
  },
  inlineBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fcd34d',
  },
  showMoreText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: TEAL,
  },
  verdictTitle: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  verdictText: {
    marginTop: 4,
    fontSize: 14,
    color: '#9ca3af',
  },
  verdictBodyText: {
    marginTop: 8,
    fontSize: 13,
    color: '#9ca3af',
  },
  buttonRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEAL,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryButtonText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: '#020617',
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: TEAL,
    backgroundColor: 'transparent',
  },
  secondaryButtonText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: TEAL,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
  },
  loadingSubtext: {
    marginTop: 4,
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#f97373',
    textAlign: 'center',
  },
  expandedVerdictContainer: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#111827',
  },
  tbHeader: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 8,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 10,
  },
  sectionTextCol: {
    flex: 1,
  },
  chipContainer: {
    alignItems: 'flex-end',
  },
  sectionBody: {
    marginTop: 8,
    marginBottom: 12,
    fontSize: 16,
    lineHeight: 24,
    color: 'rgba(255, 255, 255, 0.82)',
    letterSpacing: 0,
  },
  sectionBlock: {
    marginTop: 10,
    marginBottom: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    color: '#020617',
    fontWeight: '800',
    overflow: 'hidden',
  },
  allergenPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    marginBottom: 2,
  },
  allergenPill: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    marginRight: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#4b5563',
  },
  allergenPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ffffff',
  },
  allergenPillUser: {
    backgroundColor: '#F97373',
    borderColor: '#F97373',
  },
  allergenPillOther: {
    backgroundColor: '#4b5563',
  },
  allergenPillNeutral: {
    backgroundColor: '#374151',
  },
  allergenPillSelected: {
    backgroundColor: '#F97373',
    borderColor: '#F97373',
  },
  allergenPillTextSelected: {
    color: '#0B1120',
    fontWeight: '600',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    marginBottom: 4,
  },
  fodmapLevelBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#6B7280',
    marginTop: 4,
    marginBottom: 4,
  },
  fodmapLevelText: {
    color: '#F9FAFB',
    fontWeight: '600',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  fodmapPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4B5563',
    marginRight: 8,
    marginBottom: 8,
  },
  fodmapPillText: {
    color: '#E5E7EB',
    fontSize: 13,
  },
  chipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    color: '#020617',
  },
  nutritionSection: {
    marginTop: 10,
  },
  plateComponentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  plateComponentMain: {
    flex: 1,
    marginRight: 8,
  },
  plateComponentName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  plateComponentMeta: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  plateComponentMacros: {
    alignItems: 'flex-end',
  },
  plateComponentMacro: {
    fontSize: 12,
    fontWeight: '500',
    color: '#e5e7eb',
  },
  plateComponentAllergens: {
    marginTop: 4,
  },
  plateComponentPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 2,
  },
  plateComponentsSection: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  plateComponentsLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 8,
    fontWeight: '500',
  },
  plateComponentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    marginRight: 8,
  },
  plateComponentPillActive: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  plateComponentPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d1d5db',
  },
  plateComponentPillTextActive: {
    color: '#ffffff',
  },
  plateComponentRoleText: {
    fontSize: 11,
    color: '#6b7280',
  },
  plateComponentFodmapText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  focusChipsRow: {
    marginTop: 8,
    marginBottom: 4,
  },
  focusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#444',
    marginRight: 6,
  },
  focusChipActive: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  focusChipText: {
    fontSize: 12,
    color: '#cccccc',
  },
  focusChipTextActive: {
    color: '#000000',
  },
  focusChipsContent: {
    paddingHorizontal: 4,
  },
  focusHint: {
    fontSize: 11,
    color: '#888888',
    marginTop: 4,
  },
  sideFodmapWarningText: {
    fontSize: 11,
    color: '#f0c36a',
    marginTop: 4,
  },
  nutritionGrid: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  nutritionTile: {
    width: '48%',
    backgroundColor: '#020819',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  nutritionLabel: {
    fontSize: 12,
    color: '#9ca3af',
  },
  nutritionValue: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  nutritionUnavailable: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  dietTagsSection: {
    marginTop: 12,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  collapsibleRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
  },
  dietTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  dietTagChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#eee',
    marginRight: 6,
    marginBottom: 6,
  },
  dietTagText: {
    fontSize: 12,
    color: '#ffffff',
  },
  dietTagsEmptyText: {
    fontSize: 12,
    color: '#ffffff',
    marginTop: 4,
  },
  allergenDisclaimer: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 4,
  },
  nutritionDisclaimer: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 4,
  },
  lifestyleDisclaimer: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 4,
  },
  nutritionInsightsBox: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  nutritionSourceLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 4,
  },
  nutritionInsightsSummary: {
    marginTop: 8,
    marginBottom: 12,
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0,
  },
  nutritionInsightsHighlight: {
    color: '#cbd5e1',
    fontSize: 12,
    marginBottom: 2,
  },
  nutritionInsightsCaution: {
    color: '#fbbf24',
    fontSize: 12,
    marginTop: 4,
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#050509',
    borderTopWidth: 1,
    borderTopColor: '#1f2230',
  },
  bottomNavItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bottomNavText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  menuSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
  },
  menuSearchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
  },
  noResultsText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  // New design system styles
  analysisCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
  },
  coloredPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 6,
    marginBottom: 6,
  },
  coloredPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  levelBadgeSmall: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  levelBadgeSmallText: {
    fontSize: 11,
    fontWeight: '600',
  },
  // Quick stats for nutrition
  quickStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  quickStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  quickStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  quickStatLabel: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  quickStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#374151',
  },
  // Horizontal organ cards
  organCardsContainer: {
    paddingVertical: 8,
    gap: 10,
  },
  organCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    minWidth: 80,
    marginRight: 10,
  },
  organCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  organCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  organCardLevel: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  organCardLevelText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
  },
  // Sticky Action Bar styles
  stickyActionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 60, // Above the bottom nav
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
    alignItems: 'center',
  },
  stickyActionDishName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 8,
    textAlign: 'center',
  },
  stickyActionButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  stickyPrimaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: TEAL,
  },
  stickyPrimaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#020617',
  },
  stickySecondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: TEAL,
    backgroundColor: 'transparent',
  },
  stickySecondaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: TEAL,
  },
  // NEW: Teal-only inline badge styles
  inlineBadgeTeal: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(20, 184, 166, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.brandTeal,
  },
  inlineBadgeTextTeal: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.brandTealLight,
  },
  // NEW: Module wrapper styles for expandable cards
  moduleWrapper: {
    marginTop: 12,
  },
  // NEW: Nutrition module styles
  nutritionModuleWrapper: {
    marginTop: 12,
  },
  nutritionCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  nutritionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  nutritionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  macrosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  macroItem: {
    alignItems: 'center',
    flex: 1,
  },
  macroValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  macroLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 2,
  },
  macroValueTeal: {
    color: COLORS.brandTeal,
  },
  macroLabelTeal: {
    color: COLORS.brandTeal,
  },
  macroDivider: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.cardBorder,
  },
  // NEW: Inline action button styles
  inlineActionsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
  },
  primaryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: COLORS.brandTeal,
  },
  primaryActionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
  },
  secondaryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: COLORS.brandTeal,
    backgroundColor: 'transparent',
  },
  secondaryActionText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.brandTealLight,
  },
});
