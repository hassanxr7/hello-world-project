-- First, add unique constraint on visitor_id in visitor_tracking
CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_tracking_visitor_id_unique 
ON public.visitor_tracking(visitor_id);

-- Add page visit history tracking table (without foreign key first)
CREATE TABLE IF NOT EXISTS public.visitor_page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id TEXT NOT NULL,
  page_url TEXT NOT NULL,
  page_title TEXT,
  time_spent_seconds INTEGER DEFAULT 0,
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on visitor_page_views
ALTER TABLE public.visitor_page_views ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read page views
CREATE POLICY "Authenticated users can read page views"
ON public.visitor_page_views
FOR SELECT
TO authenticated
USING (true);

-- Policy: Anyone can insert page views
CREATE POLICY "Anyone can insert page views"
ON public.visitor_page_views
FOR INSERT
WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_visitor_page_views_visitor_id ON public.visitor_page_views(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visitor_page_views_viewed_at ON public.visitor_page_views(viewed_at DESC);

-- Add function to calculate session duration
CREATE OR REPLACE FUNCTION public.get_visitor_session_duration(p_visitor_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  duration INTEGER;
BEGIN
  SELECT EXTRACT(EPOCH FROM (MAX(last_active) - MIN(created_at)))::INTEGER
  INTO duration
  FROM visitor_tracking
  WHERE visitor_id = p_visitor_id;
  
  RETURN COALESCE(duration, 0);
END;
$$;