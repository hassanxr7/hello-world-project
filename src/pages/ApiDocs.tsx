import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code2, Key, BookOpen, Zap } from "lucide-react";

const ApiDocs = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <section className="py-20 bg-gradient-to-br from-primary/10 via-background to-secondary/10">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Code2 className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold">API Documentation</h1>
            <p className="text-xl text-muted-foreground">
              Integrate HubdexPay payment solutions into your application
            </p>
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="container mx-auto px-4">
          <Tabs defaultValue="overview" className="space-y-8">
            <TabsList className="grid w-full max-w-2xl mx-auto grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="authentication">Auth</TabsTrigger>
              <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
              <TabsTrigger value="examples">Examples</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5" />
                    Getting Started
                  </CardTitle>
                  <CardDescription>
                    Learn how to integrate HubdexPay API into your application
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-semibold">Base URL</h3>
                    <code className="block bg-muted p-3 rounded-lg">
                      https://api.hubdexpay.com/v1
                    </code>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold">API Features</h3>
                    <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                      <li>Accept payments from multiple payment methods</li>
                      <li>Real-time transaction status updates</li>
                      <li>Webhook notifications for payment events</li>
                      <li>Comprehensive transaction reports</li>
                      <li>Test and production environments</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>

              <div className="grid md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader>
                    <Key className="w-8 h-8 text-primary mb-2" />
                    <CardTitle>Secure</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      All API requests use HTTPS encryption with API key authentication
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <Zap className="w-8 h-8 text-primary mb-2" />
                    <CardTitle>Fast</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Low latency responses with 99.9% uptime guarantee
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <Code2 className="w-8 h-8 text-primary mb-2" />
                    <CardTitle>Easy</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      RESTful API with clear documentation and code examples
                    </p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="authentication" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>API Authentication</CardTitle>
                  <CardDescription>
                    Authenticate your API requests using your secret key
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-semibold">Authorization Header</h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      Include your API key in the Authorization header of each request:
                    </p>
                    <code className="block bg-muted p-3 rounded-lg text-sm">
                      Authorization: Bearer YOUR_SECRET_KEY
                    </code>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold">Getting Your API Key</h3>
                    <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                      <li>Sign up for a HubdexPay account</li>
                      <li>Navigate to Settings → API Keys</li>
                      <li>Generate a new API key for your application</li>
                      <li>Keep your secret key secure and never share it publicly</li>
                    </ol>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="endpoints" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Create Payment</CardTitle>
                  <CardDescription>POST /payments</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-semibold">Request Body</h3>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "amount": 100.00,
  "currency": "ETB",
  "customer": {
    "email": "customer@example.com",
    "name": "John Doe"
  },
  "callback_url": "https://yoursite.com/callback",
  "return_url": "https://yoursite.com/success"
}`}
                    </pre>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold">Response</h3>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "id": "pay_123456789",
  "status": "pending",
  "amount": 100.00,
  "currency": "ETB",
  "payment_url": "https://checkout.hubdexpay.com/pay_123456789",
  "created_at": "2025-01-15T12:00:00Z"
}`}
                    </pre>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Get Payment Status</CardTitle>
                  <CardDescription>GET /payments/:id</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-semibold">Response</h3>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "id": "pay_123456789",
  "status": "completed",
  "amount": 100.00,
  "currency": "ETB",
  "customer": {
    "email": "customer@example.com",
    "name": "John Doe"
  },
  "payment_method": "telebirr",
  "completed_at": "2025-01-15T12:05:00Z"
}`}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="examples" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>JavaScript Example</CardTitle>
                  <CardDescription>Using fetch API</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`const response = await fetch('https://api.hubdexpay.com/v1/payments', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_SECRET_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    amount: 100.00,
    currency: 'ETB',
    customer: {
      email: 'customer@example.com',
      name: 'John Doe'
    },
    return_url: 'https://yoursite.com/success'
  })
});

const payment = await response.json();
console.log('Payment URL:', payment.payment_url);`}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Python Example</CardTitle>
                  <CardDescription>Using requests library</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import requests

headers = {
    'Authorization': 'Bearer YOUR_SECRET_KEY',
    'Content-Type': 'application/json'
}

data = {
    'amount': 100.00,
    'currency': 'ETB',
    'customer': {
        'email': 'customer@example.com',
        'name': 'John Doe'
    },
    'return_url': 'https://yoursite.com/success'
}

response = requests.post(
    'https://api.hubdexpay.com/v1/payments',
    headers=headers,
    json=data
)

payment = response.json()
print('Payment URL:', payment['payment_url'])`}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default ApiDocs;
