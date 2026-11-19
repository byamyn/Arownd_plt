import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon, IconButton } from "@/components/ui";
import { getFavorites, toggleFavorite } from "@/lib/favorites";
import { hasFavorite, type FavoriteKind } from "@/lib/favorites-state";
import { translate } from "@/lib/i18n";
import { useAppTheme } from "@/lib/theme";

export const FAVORITES_QUERY_KEY = ["customer-favorites"] as const;

const FAVORITE_PINK = "#E85D91";
const FAVORITE_PINK_SURFACE = "#FCE4EC";
const FAVORITE_PINK_SURFACE_DARK = "#3A1F2B";

export function useFavoriteToggle(kind: FavoriteKind, id: string) {
  const queryClient = useQueryClient();
  const favorites = useQuery({
    queryKey: FAVORITES_QUERY_KEY,
    queryFn: getFavorites
  });
  const mutation = useMutation({
    mutationFn: () => toggleFavorite(kind, id),
    onSuccess: (next) => {
      queryClient.setQueryData(FAVORITES_QUERY_KEY, next);
      void queryClient.invalidateQueries({ queryKey: ["customer-favorites-content"] });
    }
  });
  return {
    active: favorites.data ? hasFavorite(favorites.data, kind, id) : false,
    disabled: favorites.isPending || mutation.isPending || favorites.isError,
    toggle: () => mutation.mutate()
  };
}

export function FavoriteButton({ kind, id, iconOnly = false }: { kind: FavoriteKind; id: string; iconOnly?: boolean }) {
  const theme = useAppTheme();
  const { active, disabled, toggle } = useFavoriteToggle(kind, id);
  const label = translate(active ? "favoriteSaved" : "favoriteAdd");

  if (iconOnly) {
    return (
      <IconButton
        accessibilityLabel={label}
        onPress={toggle}
        disabled={disabled}
        variant="surface"
        size={44}
        icon={<Icon name="heart" size={20} color={active ? FAVORITE_PINK : theme.colors.muted} fill={active ? FAVORITE_PINK : "none"} accessibilityHidden />}
        style={{
          backgroundColor: active ? (theme.mode === "dark" ? FAVORITE_PINK_SURFACE_DARK : FAVORITE_PINK_SURFACE) : theme.colors.surface,
          borderColor: active ? FAVORITE_PINK : theme.colors.border
        }}
      />
    );
  }

  return (
    <Button
      label={label}
      onPress={() => mutation.mutate()}
      variant="outline"
      size="sm"
      disabled={disabled}
      startIcon={
        <Icon name="heart" size={19} color={active ? FAVORITE_PINK : theme.colors.muted} accessibilityHidden />
      }
      textStyle={{ color: active ? FAVORITE_PINK : theme.colors.foreground, fontSize: 11 }}
      style={{
        minHeight: 44,
        minWidth: 112,
        borderRadius: 13,
        backgroundColor: active ? (theme.mode === "dark" ? FAVORITE_PINK_SURFACE_DARK : FAVORITE_PINK_SURFACE) : theme.colors.surface,
        borderColor: active ? FAVORITE_PINK : theme.colors.border
      }}
    />
  );
}
