import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon, IconButton } from "@/components/ui";
import { getFavorites, toggleFavorite } from "@/lib/favorites";
import { hasFavorite, type FavoriteKind } from "@/lib/favorites-state";
import { translate } from "@/lib/i18n";

export const FAVORITES_QUERY_KEY = ["customer-favorites"] as const;

const FAVORITE_CORAL = "#F0646A";
const FAVORITE_IDLE_SURFACE = "#F2F2F0";
const FAVORITE_ACTIVE_SURFACE = "#FFE9ED";
const FAVORITE_IDLE_ICON = "#343434";

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

export function FavoriteButton({ kind, id, iconOnly = false, floating = false }: { kind: FavoriteKind; id: string; iconOnly?: boolean; floating?: boolean }) {
  const { active, disabled, toggle } = useFavoriteToggle(kind, id);
  const label = translate(active ? "favoriteSaved" : "favoriteAdd");

  if (iconOnly) {
    return (
      <IconButton
        accessibilityLabel={label}
        onPress={toggle}
        disabled={disabled}
        variant="surface"
        size={floating ? 36 : 44}
        icon={<Icon name="heart" size={floating ? 17 : 20} color={active ? FAVORITE_CORAL : FAVORITE_IDLE_ICON} fill={active ? FAVORITE_CORAL : "none"} accessibilityHidden />}
        style={{
          backgroundColor: active ? FAVORITE_ACTIVE_SURFACE : FAVORITE_IDLE_SURFACE,
          borderColor: "transparent"
        }}
      />
    );
  }

  return (
    <Button
      label={label}
      onPress={toggle}
      variant="outline"
      size="sm"
      disabled={disabled}
      startIcon={
        <Icon name="heart" size={19} color={active ? FAVORITE_CORAL : FAVORITE_IDLE_ICON} accessibilityHidden />
      }
      textStyle={{ color: active ? FAVORITE_CORAL : FAVORITE_IDLE_ICON, fontSize: 11 }}
      style={{
        minHeight: 44,
        minWidth: 112,
        borderRadius: 13,
        backgroundColor: active ? FAVORITE_ACTIVE_SURFACE : FAVORITE_IDLE_SURFACE,
        borderColor: "transparent"
      }}
    />
  );
}
