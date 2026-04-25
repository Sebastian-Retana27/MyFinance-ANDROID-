import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { uiHeight, uiRadius, uiSpacing, uiTypography } from '../ui/tokens';

export type HorizontalTabItem<T extends string> = {
  key: T;
  label: string;
};

type HorizontalTabsProps<T extends string> = {
  items: HorizontalTabItem<T>[];
  activeKey: T;
  onChange: (key: T) => void;
  colors: {
    border: string;
    text: string;
    activeText: string;
    activeBg: string;
    activeBorder: string;
    surface: string;
    indicator: string;
  };
};

export function HorizontalTabs<T extends string>({
  items,
  activeKey,
  onChange,
  colors,
}: HorizontalTabsProps<T>) {
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <TouchableOpacity
              key={item.key}
              onPress={() => onChange(item.key)}
              style={[
                styles.tab,
                {
                  borderColor: active ? colors.activeBorder : colors.border,
                  backgroundColor: active ? colors.activeBg : colors.surface,
                },
              ]}
            >
              <Text
                style={[
                  styles.label,
                  { color: active ? colors.activeText : colors.text },
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={[styles.bottomBar, { backgroundColor: colors.border }]}>
        <View style={[styles.bottomBarThumb, { backgroundColor: colors.indicator }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: uiSpacing.xs,
  },
  scrollContent: {
    flexDirection: 'row',
    gap: uiSpacing.xs,
    paddingRight: uiSpacing.sm,
  },
  tab: {
    flexShrink: 0,
    minHeight: uiHeight.chip,
    borderWidth: 1,
    borderRadius: uiRadius.pill,
    paddingHorizontal: uiSpacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: uiTypography.caption,
    fontWeight: '700',
  },
  bottomBar: {
    alignSelf: 'center',
    width: 56,
    height: 3,
    borderRadius: uiRadius.pill,
    overflow: 'hidden',
  },
  bottomBarThumb: {
    width: 24,
    height: 3,
    borderRadius: uiRadius.pill,
    alignSelf: 'center',
  },
});
