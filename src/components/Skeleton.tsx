import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type SkeletonBlockProps = {
  width?: number | `${number}%` | 'auto';
  height: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

export function SkeletonBlock({ width = '100%', height, borderRadius = 12, style }: SkeletonBlockProps) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.85,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.block,
        {
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
}

type SkeletonRowsProps = {
  rows?: number;
  rowHeight?: number;
  gap?: number;
};

export function SkeletonRows({ rows = 4, rowHeight = 54, gap = 10 }: SkeletonRowsProps) {
  return (
    <View style={[styles.rowsWrap, { gap }]}>
      {Array.from({ length: rows }).map((_, idx) => (
        <SkeletonBlock key={`skeleton-row-${idx}`} height={rowHeight} borderRadius={14} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: '#263244',
  },
  rowsWrap: {
    width: '100%',
  },
});
