export const uiSpacing = {
  xxs: 6,
  xs: 10,
  sm: 14,
  md: 18,
  lg: 24,
  xl: 30,
} as const;

export const uiRadius = {
  sm: 12,
  md: 16,
  lg: 22,
  pill: 999,
} as const;

export const uiTypography = {
  title: 30,
  section: 18,
  body: 15,
  caption: 12,
  tiny: 11,
} as const;

export const uiHeight = {
  button: 48,
  buttonCompact: 42,
  input: 50,
  chip: 36,
  iconButton: 40,
} as const;

export const uiElevation = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  modal: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
} as const;
