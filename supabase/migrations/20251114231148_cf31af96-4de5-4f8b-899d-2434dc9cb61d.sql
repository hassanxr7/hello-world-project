-- Create chat messages table
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  email TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'unread',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert messages
CREATE POLICY "Anyone can send messages"
ON public.chat_messages
FOR INSERT
TO anon
WITH CHECK (true);

-- Policy: Authenticated users can read all messages
CREATE POLICY "Authenticated users can read messages"
ON public.chat_messages
FOR SELECT
TO authenticated
USING (true);

-- Policy: Authenticated users can update messages
CREATE POLICY "Authenticated users can update messages"
ON public.chat_messages
FOR UPDATE
TO authenticated
USING (true);

-- Create content management table for dynamic website content
CREATE TABLE public.website_content (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  section TEXT NOT NULL,
  title TEXT,
  description TEXT,
  image_url TEXT,
  link_url TEXT,
  order_index INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.website_content ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read active content
CREATE POLICY "Anyone can read active content"
ON public.website_content
FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Policy: Authenticated users can manage content
CREATE POLICY "Authenticated users can manage content"
ON public.website_content
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_website_content_updated_at
BEFORE UPDATE ON public.website_content
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();