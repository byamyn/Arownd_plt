import type { QueryClient } from "@tanstack/react-query";

import {
  fetchProductDetails,
  fetchProductOffers,
  fetchStoreDetails,
  fetchStoreOffers
} from "@/lib/catalog";
import { fetchApprovedReviews } from "@/lib/reviews";

export function prefetchCustomerProduct(queryClient: QueryClient, productId: string): void {
  if (!productId) return;

  void Promise.all([
    queryClient.prefetchQuery({
      queryKey: ["customer-product", productId],
      queryFn: ({ signal }) => fetchProductDetails(productId, signal)
    }),
    queryClient.prefetchQuery({
      queryKey: ["customer-product-offers", productId],
      queryFn: ({ signal }) => fetchProductOffers(productId, signal)
    }),
    queryClient.prefetchQuery({
      queryKey: ["approved-reviews", "product", productId],
      queryFn: ({ signal }) => fetchApprovedReviews("product", productId, signal)
    })
  ]);
}

export function prefetchCustomerStore(queryClient: QueryClient, storeId: string): void {
  if (!storeId) return;

  void Promise.all([
    queryClient.prefetchQuery({
      queryKey: ["customer-store", storeId],
      queryFn: ({ signal }) => fetchStoreDetails(storeId, signal)
    }),
    queryClient.prefetchQuery({
      queryKey: ["customer-store-offers", storeId],
      queryFn: ({ signal }) => fetchStoreOffers(storeId, signal)
    })
  ]);
}
