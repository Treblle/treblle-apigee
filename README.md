# Treblle - API Intelligence Platform

[![Treblle API Intelligence](https://github.com/user-attachments/assets/b268ae9e-7c8a-4ade-95da-b4ac6fce6eea)](https://treblle.com)

[Website](http://treblle.com/) • [Documentation](https://docs.treblle.com/) • [Pricing](https://treblle.com/pricing)

Treblle is an API intelligence platfom that helps developers, teams and organizations understand their APIs from a single integration point.

---

## Treblle Apigee SDK
The Treblle Apigee SDK brings native support to Google Apigee API Gateway across all Apigee versions. The SDK captures data in real-time with zero-latency and sends that data to Treblle for processing. 

## Supported Apigee Versions

| Framework | Supported Versions | Status |
|-------------------|-------------------|---------------------|
| **Apigee Edge** | All Versions| ✅ Full Support|
| **Apigee X** | All Versions | ✅ Full Support |
| **Apigee Hybrid** | All Versions | ✅ Full Support |

### Required Permissions
- **API Proxy Developer**: To deploy policies and resources
- **Environment Admin**: To create and manage Key Value Maps
- **Shared Flow Developer**: To create the async logging flow

### Network Requirements
- Outbound HTTPS access to Treblle endpoints:
  - `rocknrolla.treblle.com`
  - `punisher.treblle.com`
  - `sicario.treblle.com`
- Ports: 443 (HTTPS)

## Installation

### Step 1: Get Your Treblle Credentials

1. Sign up for a free account at [treblle.com](https://treblle.com)
2. Create a new API in your Treblle dashboard
3. Copy your **SDK Token** and **API Key** from the project settings

### Step 2: Create Environment Configuration

#### Option A: Using Apigee Management API (Recommended)

Replace the placeholders with your actual values:
- `YOUR_ORGANIZATION`: Your Apigee organization name
- `YOUR_ENVIRONMENT`: Target environment (test, prod, etc.)
- `YOUR_TREBLLE_SDK_TOKEN`: From your Treblle project
- `YOUR_TREBLLE_API_KEY`: From your Treblle project

```bash
# Create the KVM
curl -X POST "https://apigee.googleapis.com/v1/organizations/YOUR_ORGANIZATION/environments/YOUR_ENVIRONMENT/keyvaluemaps" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "treblle-kvm",
    "encrypted": true
  }'

# Add SDK Token
curl -X POST "https://apigee.googleapis.com/v1/organizations/YOUR_ORGANIZATION/environments/YOUR_ENVIRONMENT/keyvaluemaps/treblle-kvm/entries" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "treblle_sdk_token",
    "value": "YOUR_TREBLLE_SDK_TOKEN"
  }'

# Add API Key
curl -X POST "https://apigee.googleapis.com/v1/organizations/YOUR_ORGANIZATION/environments/YOUR_ENVIRONMENT/keyvaluemaps/treblle-kvm/entries" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "treblle_api_key", 
    "value": "YOUR_TREBLLE_API_KEY"
  }'

# Verify the setup
curl "https://apigee.googleapis.com/v1/organizations/YOUR_ORGANIZATION/environments/YOUR_ENVIRONMENT/keyvaluemaps/treblle-kvm/entries" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

#### Option B: Using Apigee UI

1. Navigate to **Admin > Environments > Key Value Maps**
2. Click **+ Key Value Map**
3. Name: `treblle-kvm`
4. Enable **Encrypted** checkbox
5. Click **Create**
6. Add entries:
   - Key: `treblle_sdk_token`, Value: `YOUR_TREBLLE_SDK_TOKEN`
   - Key: `treblle_api_key`, Value: `YOUR_TREBLLE_API_KEY`

### Step 3: Deploy the Shared Flow

1. In Apigee UI, go to **Develop > Shared Flows**
2. Click **+ Shared Flow**
3. Name: `treblle-logger`
4. Upload or copy the content from `sharedflows/policies/SC-SendToTreblle.xml`
5. Deploy to your target environment

**Shared Flow XML:**
```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<SharedFlow name="treblle-logger">
  <Step>
    <Name>SC-SendToTreblle</Name>
  </Step>
</SharedFlow>
```

### Step 4: Configure Your API Proxy

#### Upload Resources
1. Go to **Develop > API Proxies > [Your Proxy]**
2. Navigate to **Resources > JavaScript**
3. Click **+ Resource**
4. Upload `treblle-payload-processor.js`

#### Create Policies
1. Go to **Policies**
2. Create **JavaScript Policy**:
   - Name: `JS-ProcessTrebllePayload`
   - Resource: `treblle-payload-processor.js`
3. Create **Key Value Map Policy**:
   - Name: `KVM-GetTreblleCredentials`  
   - Copy content from `KVM-GetTreblleCredentials.xml`
   - Update `mapIdentifier` to `treblle-kvm`
4. Create **Flow Callout Policy**:
   - Name: `FC-TreblleAsyncLogger`
   - Shared Flow: `treblle-logger`

#### Attach to Flow

**PreFlow Response (Required):**
```xml
<Response>
  <Step>
    <Name>JS-ProcessTrebllePayload</Name>
  </Step>
</Response>
```

**PostFlow Request (Required):**
```xml
<Request>
  <Step>
    <Name>KVM-GetTreblleCredentials</Name>
  </Step>
</Request>
```

**PostFlow Response (Required):**
```xml
<Response>
  <Step>
    <Name>FC-TreblleAsyncLogger</Name>
  </Step>
</Response>
```

## Configuration

### Data Masking

Customize sensitive data detection by modifying the `maskingKeywords` variable:

```javascript
// Default masking keywords
var maskingKeywords = 'password,secret,token,key,authorization,auth,credential,private,confidential,ssn,social_security,credit_card,card_number,cvv,pin,api_key,access_token,refresh_token,bearer,x-api-key,x-auth-token';

// Add your custom keywords
var maskingKeywords = 'password,secret,token,key,authorization,auth,credential,private,confidential,ssn,social_security,credit_card,card_number,cvv,pin,api_key,access_token,refresh_token,bearer,x-api-key,x-auth-token,customer_id,user_id,email,phone';
```

**Masking Behavior:**
- Preserves original string length
- Replaces all characters with `*`
- Works in request/response bodies and headers
- Case-insensitive matching
- Supports nested JSON objects and arrays

### Endpoint Blocking  

Block specific endpoints from being tracked:

```javascript
// Basic blocking
var blockedEndpoints = 'health,status,ping';

// Wildcard patterns
var blockedEndpoints = 'health,status,ping,admin/*,internal/*,v1/auth/*';

// Complex patterns
var blockedEndpoints = 'health,status,ping,admin/*,internal/*,*/private/*,test-*';
```

**Wildcard Support:**
- `admin/*` - Blocks all paths starting with `admin/`
- `*/private/*` - Blocks any path containing `/private/`  
- `test-*` - Blocks paths starting with `test-`

### Debug Mode

Enable detailed logging for troubleshooting:

```javascript
var debugMode = true;  // Enable debug logging
```

**Debug Output Includes:**
- Configuration validation results
- Payload building process
- Endpoint blocking decisions
- Error details and stack traces
- Performance timing information

### Environment-Specific Configuration

Use different KVM names for different environments:

**Development:**
```xml
<KeyValueMapOperations mapIdentifier="treblle-kvm-dev">
```

**Production:**
```xml
<KeyValueMapOperations mapIdentifier="treblle-kvm-prod">
```

## Architecture Overview


```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Request   │───▶│  Apigee Proxy   │───▶│  Backend API    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ JS-ProcessPayload│ (PreFlow Response)
                       └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │KVM-GetCredentials│ (PostFlow Request)  
                       └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ FC-AsyncLogger  │ (PostFlow Response)
                       └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Shared Flow     │
                       │ SC-SendToTreblle│
                       └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Treblle API     │
                       │ (Load Balanced) │
                       └─────────────────┘
```

### Flow Execution Order

1. **PreFlow Response**: JavaScript policy captures request/response data
2. **PostFlow Request**: KVM policy retrieves credentials  
3. **PostFlow Response**: Flow Callout triggers async Shared Flow
4. **Shared Flow**: Service Callout sends data to Treblle
5. **Client Response**: Continues normally (no latency impact)

## 🔧 Troubleshooting

### Common Issues

#### 1. No Data in Treblle Dashboard

**Symptoms**: API calls work but no data appears in Treblle

**Solutions**:
```bash
# Check KVM configuration
curl "https://apigee.googleapis.com/v1/organizations/YOUR_ORG/environments/YOUR_ENV/keyvaluemaps/treblle-kvm/entries" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"

# Enable debug mode
var debugMode = true;  // In treblle-payload-processor.js

# Check Apigee logs for errors
# Look for "Treblle" in the trace logs
```

#### 2. Policy Execution Errors  

**Symptoms**: 500 errors or policy failures

**Solutions**:
```javascript
// Check policy attachment order in proxy XML
// PreFlow Response: JS-ProcessTrebllePayload
// PostFlow Request: KVM-GetTreblleCredentials  
// PostFlow Response: FC-TreblleAsyncLogger

// Verify JavaScript resource upload
// Ensure all variable names match exactly
```

#### 3. Credential Issues

**Symptoms**: Authentication errors in logs

**Solutions**:
```bash
# Verify credential format (no extra spaces/characters)
# Test credentials manually:
curl -X POST "https://rocknrolla.treblle.com" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_SDK_TOKEN" \
  -d '{"test": true}'
```

#### 4. Performance Issues

**Symptoms**: Increased API latency

**Solutions**:
```javascript
// Reduce payload size limit
var maxPayloadSize = 524288;  // 512KB instead of 2MB

// Disable body logging temporarily  
var logBody = false;

// Check blocked endpoints
var debugMode = true;  // See what's being processed
```

### Debug Mode Output

Enable debug logging to see detailed execution:

```javascript
var debugMode = true;
```

**Sample Debug Output**:
```
DEBUG: Starting Treblle SDK processing
DEBUG: Configuration validated successfully  
DEBUG: Endpoint allowed for tracking: /api/users
DEBUG: Payload built successfully
DEBUG: Payload serialized successfully - size: 1337 bytes
DEBUG: Selected host: rocknrolla.treblle.com
DEBUG: All validations passed - Treblle call prepared successfully
DEBUG: Treblle SDK processing completed
```

## Support

If you have problems of any kind feel free to reach out via <https://treblle.com> or email support@treblle.com and we'll do our best to help you out.

## License

Copyright 2025, Treblle Inc. Licensed under the MIT license:
http://www.opensource.org/licenses/mit-license.php