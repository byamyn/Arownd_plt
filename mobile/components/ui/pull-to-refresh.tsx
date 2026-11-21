import { useEffect, useRef, type ReactNode } from "react";
import { Animated, PanResponder, StyleSheet, View, type ScrollViewProps } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { useAppTheme } from "@/lib/theme";

const OUTLINE = "M693.33 353.56C692.15 351.76 691.08 349.96 689.5 348.44C683.12 342.3 666.21 334.6 657.57 328.82C640.77 317.56 627.29 301.13 619.97 282.24C602.42 236.93 623.48 196.4 641.8 155.56C650.39 136.41 657.92 116.7 667.5 98.02C679.66 74.31 698.05 48.51 727.96 50.08C752.11 51.35 770.81 69.35 781.22 89.92C791.4 110.07 795.59 132.49 800.85 154.25C809.32 189.28 818.64 218.56 811.5 255.26C807.07 278.08 796.98 299.77 781.47 317.18C776.19 323.09 753.78 342.23 752.06 346.93C750.28 351.8 758.83 353.44 761.92 353.65C773.4 354.45 785.48 348.79 795.24 343.3C821.67 328.44 842.06 303.73 846.99 273.31C853.09 235.58 841.04 198.79 829.9 163.27L818.24 125.48C808.05 92.76 795.67 60.24 762.7 44.45C754.81 40.67 746.29 37.9 737.61 36.69C705.55 32.22 683.13 49.24 666.63 75.14C653.87 95.15 644.72 117.31 634.55 138.69C614.54 180.8 591.56 224.71 602.35 272.8C608.85 301.79 627.91 327.43 652.9 343.2C661.97 348.93 673.23 354.87 684.23 354.88C687.33 354.89 690.33 354.21 693.33 353.56Z";
const CENTER = { x: 710.89, y: 237.83, r: 51.83 };
const REFRESH_THRESHOLD = 64;
const MAX_PULL = 112;

type PullToRefreshProps = {
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean;
  disabled?: boolean;
  renderContent: (onScroll: NonNullable<ScrollViewProps["onScroll"]>) => ReactNode;
};

export function PullToRefresh({ onRefresh, refreshing = false, disabled = false, renderContent }: PullToRefreshProps) {
  const theme = useAppTheme();
  const pull = useRef(new Animated.Value(0)).current;
  const pullValue = useRef(0);
  const scrollOffset = useRef(0);
  const refreshingRef = useRef(refreshing);
  const activeRef = useRef(false);
  const observedRefreshRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef({ onRefresh, disabled });
  configRef.current = { onRefresh, disabled };

  const settle = () => {
    activeRef.current = false;
    observedRefreshRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    Animated.spring(pull, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 180, mass: 0.7 }).start();
  };

  useEffect(() => {
    refreshingRef.current = refreshing;
    if (!activeRef.current) return;
    if (refreshing) {
      observedRefreshRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      return;
    }
    if (observedRefreshRef.current) {
      timeoutRef.current = setTimeout(settle, 260);
    }
  }, [refreshing]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleScroll: NonNullable<ScrollViewProps["onScroll"]> = (event) => {
    scrollOffset.current = event.nativeEvent.contentOffset.y;
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      const config = configRef.current;
      return !config.disabled && Boolean(config.onRefresh) && !refreshingRef.current && !activeRef.current &&
        scrollOffset.current <= 0 && gesture.dy > 7 && gesture.dy > Math.abs(gesture.dx) * 1.15;
    },
    onPanResponderGrant: () => {
      pullValue.current = 0;
    },
    onPanResponderMove: (_event, gesture) => {
      const next = Math.min(MAX_PULL, Math.max(0, gesture.dy * 0.52));
      pullValue.current = next;
      pull.setValue(next);
    },
    onPanResponderRelease: () => {
      if (pullValue.current >= REFRESH_THRESHOLD) {
        activeRef.current = true;
        Animated.spring(pull, { toValue: REFRESH_THRESHOLD, useNativeDriver: true, damping: 18, stiffness: 170 }).start();
        try {
          configRef.current.onRefresh?.();
        } catch {
          settle();
          return;
        }
        if (!refreshingRef.current) {
          timeoutRef.current = setTimeout(() => {
            if (activeRef.current && !observedRefreshRef.current) settle();
          }, 12_000);
        }
      } else {
        settle();
      }
    },
    onPanResponderTerminate: settle,
    onPanResponderTerminationRequest: () => false
  })).current;

  const indicatorOpacity = pull.interpolate({ inputRange: [0, 18, REFRESH_THRESHOLD], outputRange: [0, 0.55, 1], extrapolate: "clamp" });
  const indicatorScale = pull.interpolate({ inputRange: [0, REFRESH_THRESHOLD], outputRange: [0.72, 1], extrapolate: "clamp" });
  const rotate = pull.interpolate({ inputRange: [0, REFRESH_THRESHOLD], outputRange: ["-18deg", "0deg"], extrapolate: "clamp" });

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]} {...panResponder.panHandlers}>
      {onRefresh ? (
        <Animated.View pointerEvents="none" style={[styles.indicator, { opacity: indicatorOpacity, transform: [{ scale: indicatorScale }, { rotate }] }]}>
          <Svg width={48} height={48} viewBox="516.67 -12 414.88 414.88">
            <Path d={OUTLINE} fill={theme.colors.accent} fillRule="evenodd" />
            <Circle cx={CENTER.x} cy={CENTER.y} r={CENTER.r} fill={theme.colors.background} />
          </Svg>
        </Animated.View>
      ) : null}
      <Animated.View style={[styles.content, { transform: [{ translateY: pull }] }]}>
        {renderContent(handleScroll)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  content: { flex: 1 },
  indicator: { position: "absolute", top: 7, left: 0, right: 0, height: 50, alignItems: "center", justifyContent: "center", zIndex: 1 }
});
