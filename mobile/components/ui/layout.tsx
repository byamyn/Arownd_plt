import type { ComponentRef, PropsWithChildren, Ref } from "react";
import {
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { designTokens, useAppTheme } from "@/lib/theme";
import { PullToRefresh } from "./pull-to-refresh";

export type ContainerProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  paddingHorizontal?: number;
  maxWidth?: number;
  centered?: boolean;
}>;

export function Container({
  children,
  style,
  paddingHorizontal = designTokens.spacing.lg,
  maxWidth,
  centered = false
}: ContainerProps) {
  return (
    <View
      style={[
        { width: "100%", paddingHorizontal, maxWidth, alignSelf: centered ? "center" : "auto" },
        style
      ]}
    >
      {children}
    </View>
  );
}

export type StackProps = PropsWithChildren<{
  direction?: "row" | "column";
  gap?: number;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}>;

export function Stack({
  children,
  direction = "column",
  gap = designTokens.spacing.md,
  align,
  justify,
  wrap = false,
  style
}: StackProps) {
  return (
    <View
      style={[
        {
          flexDirection: direction === "row" ? "row" : "column",
          gap,
          alignItems: align,
          justifyContent: justify,
          flexWrap: wrap ? "wrap" : "nowrap"
        },
        style
      ]}
    >
      {children}
    </View>
  );
}

export type RowProps = Omit<StackProps, "direction">;
export function Row(props: RowProps) {
  return <Stack {...props} direction="row" />;
}

export type ColumnProps = Omit<StackProps, "direction">;
export function Column(props: ColumnProps) {
  return <Stack {...props} direction="column" />;
}

export function Spacer({ size = 1 }: { size?: number }) {
  return <View style={{ flex: size }} />;
}

export function Divider({
  inset = 0,
  style
}: {
  inset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  return (
    <View
      accessibilityElementsHidden
      style={[
        { height: 1, alignSelf: "stretch", marginHorizontal: inset, backgroundColor: theme.colors.border },
        style
      ]}
    />
  );
}

export function AspectRatio({
  children,
  ratio = 1,
  style
}: PropsWithChildren<{ ratio?: number; style?: StyleProp<ViewStyle> }>) {
  return <View style={[{ width: "100%", aspectRatio: ratio }, style]}>{children}</View>;
}

export type ScrollAreaProps = PropsWithChildren<
  Pick<ScrollViewProps, "horizontal" | "showsHorizontalScrollIndicator" | "showsVerticalScrollIndicator" | "onScroll" | "keyboardShouldPersistTaps" | "automaticallyAdjustKeyboardInsets"> & {
    contentContainerStyle?: ScrollViewProps["contentContainerStyle"];
    style?: ScrollViewProps["style"];
  }
>;

export type RefreshableScrollViewProps = PropsWithChildren<{
  scrollRef?: Ref<ComponentRef<typeof ScrollView>> | undefined;
  refreshing?: boolean;
  onRefresh?: (() => void) | undefined;
  contentContainerStyle?: ScrollViewProps["contentContainerStyle"];
  style?: ScrollViewProps["style"];
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
  keyboardDismissMode?: ScrollViewProps["keyboardDismissMode"];
  automaticallyAdjustKeyboardInsets?: ScrollViewProps["automaticallyAdjustKeyboardInsets"];
  showsVerticalScrollIndicator?: boolean;
  stickyHeaderIndices?: number[];
  pagingEnabled?: ScrollViewProps["pagingEnabled"];
  decelerationRate?: ScrollViewProps["decelerationRate"];
  onLayout?: ScrollViewProps["onLayout"];
}>;

export function RefreshableScrollView({
  children,
  refreshing = false,
  onRefresh,
  contentContainerStyle,
  style,
  keyboardShouldPersistTaps = "handled",
  keyboardDismissMode,
  automaticallyAdjustKeyboardInsets = true,
  showsVerticalScrollIndicator = false,
  scrollRef,
  stickyHeaderIndices,
  pagingEnabled,
  decelerationRate,
  onLayout
}: RefreshableScrollViewProps) {
  return (
    <PullToRefresh
      onRefresh={onRefresh}
      refreshing={refreshing}
      renderContent={(onScroll) => (
        <ScrollView
          ref={scrollRef}
          stickyHeaderIndices={stickyHeaderIndices}
          pagingEnabled={pagingEnabled}
          decelerationRate={decelerationRate}
          onLayout={onLayout}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={[{ flex: 1 }, style]}
          contentContainerStyle={contentContainerStyle}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          keyboardDismissMode={keyboardDismissMode}
          automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        >
          {children}
        </ScrollView>
      )}
    />
  );
}

export function ScrollArea({
  children,
  horizontal = false,
  showsHorizontalScrollIndicator = false,
  showsVerticalScrollIndicator = false,
  contentContainerStyle,
  style,
  onScroll,
  keyboardShouldPersistTaps = "handled"
}: ScrollAreaProps) {
  return (
    <ScrollView
      horizontal={horizontal}
      showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      contentContainerStyle={contentContainerStyle}
      style={style}
      onScroll={onScroll}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      automaticallyAdjustKeyboardInsets
    >
      {children}
    </ScrollView>
  );
}
