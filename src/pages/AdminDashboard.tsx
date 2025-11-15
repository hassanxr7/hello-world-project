import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LogOut, MessageSquare, FileText, Trash2, CheckCircle, Reply, Users, Bot, Settings } from "lucide-react";
import MessageReplyDialog from "@/components/MessageReplyDialog";

interface ChatMessage {
  id: string;
  name: string | null;
  email: string | null;
  message: string;
  status: string;
  created_at: string;
}

interface WebsiteContent {
  id: string;
  section: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  link_url: string | null;
  order_index: number;
  is_active: boolean;
  created_at: string;
}

interface VisitorData {
  id: string;
  visitor_id: string;
  page_url: string;
  device_type: string;
  is_bot: boolean;
  bot_name: string | null;
  pages_visited: number;
  created_at: string;
  last_active: string;
}

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState<WebsiteContent[]>([]);
  const [visitors, setVisitors] = useState<VisitorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyDialog, setReplyDialog] = useState({
    open: false,
    messageId: "",
    messageName: "",
    messageEmail: "",
    messageContent: "",
  });

  useEffect(() => {
    checkAuth();
    fetchMessages();
    fetchContent();
    fetchVisitors();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/admin/login");
    }
  };

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setMessages(data || []);
    } catch (error: any) {
      toast.error("Failed to fetch messages");
    } finally {
      setLoading(false);
    }
  };

  const fetchContent = async () => {
    try {
      const { data, error } = await supabase
        .from("website_content")
        .select("*")
        .order("order_index", { ascending: true });

      if (error) throw error;
      setContent(data || []);
    } catch (error: any) {
      toast.error("Failed to fetch content");
    }
  };

  const fetchVisitors = async () => {
    try {
      const { data, error } = await supabase
        .from("visitor_tracking")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      setVisitors(data || []);
    } catch (error: any) {
      toast.error("Failed to fetch visitor data");
    }
  };

  const openReplyDialog = (message: ChatMessage) => {
    setReplyDialog({
      open: true,
      messageId: message.id,
      messageName: message.name || "User",
      messageEmail: message.email || "No email",
      messageContent: message.message,
    });
  };

  const markAsRead = async (id: string) => {
    try {
      const { error } = await supabase
        .from("chat_messages")
        .update({ status: "read" })
        .eq("id", id);

      if (error) throw error;
      toast.success("Message marked as read");
      fetchMessages();
    } catch (error: any) {
      toast.error("Failed to update message");
    }
  };

  const deleteMessage = async (id: string) => {
    try {
      const { error } = await supabase
        .from("chat_messages")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast.success("Message deleted");
      fetchMessages();
    } catch (error: any) {
      toast.error("Failed to delete message");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">HubdexPay Admin Dashboard</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/admin/settings")}>
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
            <Button variant="outline" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <Tabs defaultValue="messages" className="space-y-4">
          <TabsList>
            <TabsTrigger value="messages">
              <MessageSquare className="w-4 h-4 mr-2" />
              Messages ({messages.filter(m => m.status === 'unread').length})
            </TabsTrigger>
            <TabsTrigger value="visitors">
              <Users className="w-4 h-4 mr-2" />
              Visitors
            </TabsTrigger>
            <TabsTrigger value="content">
              <FileText className="w-4 h-4 mr-2" />
              Content
            </TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Chat Messages</CardTitle>
                <CardDescription>Messages from website chatbot</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : messages.length === 0 ? (
                  <p className="text-muted-foreground">No messages yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Message</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {messages.map((msg) => (
                        <TableRow key={msg.id}>
                          <TableCell>
                            <Badge variant={msg.status === 'unread' ? 'default' : 'secondary'}>
                              {msg.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{msg.name || "Anonymous"}</TableCell>
                          <TableCell>{msg.email || "N/A"}</TableCell>
                          <TableCell className="max-w-md truncate">{msg.message}</TableCell>
                          <TableCell>{new Date(msg.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openReplyDialog(msg)}
                                title="Reply to message"
                              >
                                <Reply className="w-4 h-4 text-primary" />
                              </Button>
                              {msg.status === 'unread' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => markAsRead(msg.id)}
                                  title="Mark as read"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteMessage(msg.id)}
                                title="Delete message"
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="visitors" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Visitor Tracking</CardTitle>
                <CardDescription>Track website visitors and bot activity</CardDescription>
              </CardHeader>
              <CardContent>
                {visitors.length === 0 ? (
                  <p className="text-muted-foreground">No visitor data yet</p>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">Total Visitors</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-2xl font-bold">{visitors.length}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">Unique Visitors</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-2xl font-bold">
                            {new Set(visitors.map(v => v.visitor_id)).size}
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Bot className="w-4 h-4" />
                            Bot Visits
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-2xl font-bold text-orange-600">
                            {visitors.filter(v => v.is_bot).length}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Visitor ID</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Device</TableHead>
                          <TableHead>Pages</TableHead>
                          <TableHead>Last Active</TableHead>
                          <TableHead>First Visit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visitors.map((visitor) => (
                          <TableRow key={visitor.id}>
                            <TableCell className="font-mono text-xs">
                              {visitor.visitor_id.substring(0, 20)}...
                            </TableCell>
                            <TableCell>
                              {visitor.is_bot ? (
                                <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                                  <Bot className="w-3 h-3" />
                                  {visitor.bot_name || "Bot"}
                                </Badge>
                              ) : (
                                <Badge variant="secondary">Human</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{visitor.device_type}</Badge>
                            </TableCell>
                            <TableCell>{visitor.pages_visited}</TableCell>
                            <TableCell>
                              {new Date(visitor.last_active).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              {new Date(visitor.created_at).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="content" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Website Content</CardTitle>
                <CardDescription>Manage website sections and content</CardDescription>
              </CardHeader>
              <CardContent>
                {content.length === 0 ? (
                  <p className="text-muted-foreground">No content yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Section</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Order</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {content.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.section}</TableCell>
                          <TableCell>{item.title}</TableCell>
                          <TableCell>
                            <Badge variant={item.is_active ? 'default' : 'secondary'}>
                              {item.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell>{item.order_index}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <MessageReplyDialog
        open={replyDialog.open}
        onOpenChange={(open) => setReplyDialog({ ...replyDialog, open })}
        messageId={replyDialog.messageId}
        messageName={replyDialog.messageName}
        messageEmail={replyDialog.messageEmail}
        messageContent={replyDialog.messageContent}
        onReplyAdded={fetchMessages}
      />
    </div>
  );
};

export default AdminDashboard;
