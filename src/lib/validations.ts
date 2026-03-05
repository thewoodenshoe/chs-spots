import { z } from 'zod';

/** Schema for creating a new spot (POST /api/spots) */
export const createSpotSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  submitterName: z.string().max(100, 'Name too long').default('Anonymous'),
  description: z.string().max(2000, 'Description too long').default(''),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  type: z.string().max(50).default('Happy Hour'),
  activity: z.string().max(50).optional(),
  photoUrl: z.string().max(1_500_000, 'Photo too large').optional(),
  area: z.string().max(100).optional(),
  venueId: z.string().max(200).optional(),
  timeStart: z.string().max(5).optional(),
  timeEnd: z.string().max(5).optional(),
  days: z.array(z.number().min(0).max(6)).max(7).optional(),
  specificDate: z.string().max(10).optional(),
  promotionList: z.array(z.string().max(500)).max(20).optional(),
}).refine(
  (data) => data.venueId || (data.lat != null && data.lng != null),
  { message: 'Either venueId or lat/lng coordinates are required' },
);

/** Schema for updating a spot (PUT /api/spots/[id]) */
export const updateSpotSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(2000, 'Description too long').default(''),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  type: z.string().max(50).optional(),
  activity: z.string().max(50).optional(),
  photoUrl: z.string().max(1_500_000, 'Photo too large').optional(),
  area: z.string().max(100).optional(),
  promotionTime: z.string().max(200).optional(),
  promotionList: z.array(z.string().max(500)).max(20).optional(),
  timeStart: z.string().max(5).optional(),
  timeEnd: z.string().max(5).optional(),
  days: z.union([z.string().max(20), z.array(z.number().min(0).max(6))]).optional(),
  specificDate: z.string().max(10).optional(),
  sourceUrl: z.string().max(2000).optional(),
});

/** Schema for feedback submissions (POST /api/feedback) */
export const feedbackSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  email: z.string().max(200, 'Email too long').email('Invalid email').or(z.literal('')).default(''),
  message: z.string().min(1, 'Message is required').max(1000, 'Message too long'),
});

/** Helper: parse with Zod and return a clean error message on failure */
export function parseOrError<T>(schema: z.ZodSchema<T>, data: unknown):
  { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const firstIssue = result.error.issues[0];
  const field = firstIssue.path.join('.');
  const msg = field ? `${field}: ${firstIssue.message}` : firstIssue.message;
  return { success: false, error: msg };
}
