-- Add more location fields to visitor_tracking table
ALTER TABLE public.visitor_tracking 
ADD COLUMN IF NOT EXISTS region TEXT,
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS timezone TEXT,
ADD COLUMN IF NOT EXISTS isp TEXT;

-- Create index for location-based queries
CREATE INDEX IF NOT EXISTS idx_visitor_tracking_country ON public.visitor_tracking(country);
CREATE INDEX IF NOT EXISTS idx_visitor_tracking_city ON public.visitor_tracking(city);