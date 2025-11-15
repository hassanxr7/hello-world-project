-- Create message replies table
CREATE TABLE public.message_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reply_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on message_replies
ALTER TABLE public.message_replies ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read replies
CREATE POLICY "Anyone can read replies"
ON public.message_replies
FOR SELECT
USING (true);

-- Policy: Authenticated users can create replies (admins only in practice)
CREATE POLICY "Authenticated users can create replies"
ON public.message_replies
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Create visitor tracking table
CREATE TABLE public.visitor_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id TEXT NOT NULL,
  page_url TEXT NOT NULL,
  referrer TEXT,
  user_agent TEXT,
  ip_address TEXT,
  country TEXT,
  city TEXT,
  device_type TEXT,
  is_bot BOOLEAN DEFAULT false,
  bot_name TEXT,
  session_duration INTEGER,
  pages_visited INTEGER DEFAULT 1,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on visitor_tracking
ALTER TABLE public.visitor_tracking ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read visitor data
CREATE POLICY "Authenticated users can read visitor tracking"
ON public.visitor_tracking
FOR SELECT
TO authenticated
USING (true);

-- Policy: Anyone can insert visitor tracking (for client-side tracking)
CREATE POLICY "Anyone can insert visitor tracking"
ON public.visitor_tracking
FOR INSERT
WITH CHECK (true);

-- Policy: Anyone can update their own visitor tracking
CREATE POLICY "Anyone can update visitor tracking"
ON public.visitor_tracking
FOR UPDATE
USING (true);

-- Create index for better query performance
CREATE INDEX idx_visitor_tracking_visitor_id ON public.visitor_tracking(visitor_id);
CREATE INDEX idx_visitor_tracking_created_at ON public.visitor_tracking(created_at DESC);
CREATE INDEX idx_visitor_tracking_is_bot ON public.visitor_tracking(is_bot);
CREATE INDEX idx_message_replies_message_id ON public.message_replies(message_id);