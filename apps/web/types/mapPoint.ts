/** Snippet objects from ingest `google_reviews` (Place Details). */
export type GoogleReviewSnippet = {
  author_name?: string | null;
  rating?: number | null;
  text?: string | null;
  text_original?: string | null;
  relative_time_description?: string | null;
  /** Unix seconds from Google Places `time` (when ingested). */
  time_unix?: number | null;
};

export type MapPoint = {
  inpost_point_id?: string | null;
  partner_id?: number | string | null;
  latitude: number;
  longitude: number;
  name?: string | null;
  /** InPost directory status when backfilled on the point document. */
  status?: string | null;
  validation_status?: string | null;
  formatted_address?: string | null;
  google_maps_uri?: string | null;
  google_rating?: number | null;
  google_user_ratings_total?: number | null;
  google_reviews?: GoogleReviewSnippet[] | null;
  distance_to_google_place_m?: number | null;
  /** Denormalized from ``google_reviews[*].time_unix`` (ingest / backfill). */
  google_reviews_time_unix_min?: number | null;
  google_reviews_time_unix_max?: number | null;
  /** Max trimmed review body length (matches ``mapSpotlightPresets`` / ``point_utils``). */
  review_snippet_max_text_len?: number;
  review_snippet_star_spread?: number | null;
  review_snippet_star_variance?: number | null;
  review_snippet_star_count?: number;
};

/** From ``GET /points/{id}`` only; merged onto list selection for the detail panel. */
export type MapPointDetailOverlay = Pick<
  MapPoint,
  "formatted_address" | "google_maps_uri" | "status" | "validation_status"
>;
