# Treblle Apigee Policy

This repository contains a custom Apigee policy to automatically send API request and response data to your [Treblle](https://treblle.com/) project. It helps you monitor, debug, and observe your APIs with ease.

## Overview

The policy captures detailed information about each API transaction processed by your Apigee proxy. This includes request and response headers, bodies, server information, load times, and errors. The collected data is then securely sent to your Treblle project for real-time analysis and visualization.

This implementation is designed to be non-blocking. It collects data during the response flow and sends it asynchronously to Treblle, ensuring that it does not add latency to the responses sent to your clients.

## Features

- **Easy Integration**: Simple to add to any Apigee API proxy.
- **Asynchronous Logging**: Uses a Shared Flow with Service Callouts in the PostFlow to avoid impacting client response times.
- **Configurable**: Easily set your Treblle API Key and Project ID.
- **Data Masking**: Automatically masks sensitive information (e.g., passwords, credit cards) in request/response bodies to protect privacy. You can customize the masking keywords by editing the `maskingKeywords` variable in `treblle-apigee-policy.js` (comma-separated list).
- **Detailed Error Reporting**: Captures Apigee fault variables and HTTP error states automatically.
- **Robust and Safe**: Includes validation and error handling to prevent policy failures.

## Components

1. **`treblle-apigee-policy.js`**: A JavaScript policy that:

   - Collects request, response, server, and error data.
   - Formats the data into the JSON payload expected by the Treblle API.
   - Masks sensitive data in request/response bodies based on configurable keywords.
   - Stores the payload and required HTTP headers into Apigee context variables.
   - Randomly selects primary and fallback Treblle hosts for load balancing and failover.

2. **`KVM-Treblle.xml`**: A Key Value Map Operations policy that retrieves the Treblle API key and project ID from an environment-scoped KVM.

3. **`SC-Call-Treblle-Primary.xml`**: A Service Callout policy that makes an asynchronous HTTP POST request to the primary Treblle endpoint.

4. **`SC-Call-Treblle-Fallback.xml`**: A Service Callout policy that makes an asynchronous HTTP POST request to the fallback Treblle endpoint, triggered only if the primary callout fails.

## Installation and Configuration

Follow these steps to integrate the Treblle policy into your Apigee API proxy:

### 1. Create a Key Value Map (KVM)

First, create an environment-scoped KVM to store your Treblle credentials securely. You can do this via the Apigee UI or API.

**Via API (recommended for automation):**

Replace `YOUR_ORGANIZATION`, `YOUR_ENVIRONMENT`, and choose a KVM name (e.g., `treblle-kvm`):

```bash
curl -X POST "https://apigee.googleapis.com/v1/organizations/YOUR_ORGANIZATION/environments/YOUR_ENVIRONMENT/keyvaluemaps" \
-H "Authorization: Bearer $(gcloud auth print-access-token)" \
-H "Content-Type: application/json" \
-d '{
  "name": "treblle-kvm",
  "encrypted": true
}'
```

### 2. Populate the KVM with Treblle Credentials

Add your Treblle API key and project ID to the KVM:

```bash
curl -X POST "https://apigee.googleapis.com/v1/organizations/YOUR_ORGANIZATION/environments/YOUR_ENVIRONMENT/keyvaluemaps/treblle-kvm/entries" \
-H "Authorization: Bearer $(gcloud auth print-access-token)" \
-H "Content-Type: application/json" \
-d '{ "name": "treblle_api_key", "value": "YOUR_TREBLLE_API_KEY" }'
```

```bash
curl -X POST "https://apigee.googleapis.com/v1/organizations/YOUR_ORGANIZATION/environments/YOUR_ENVIRONMENT/keyvaluemaps/treblle-kvm/entries" \
-H "Authorization: Bearer $(gcloud auth print-access-token)" \
-H "Content-Type: application/json" \
-d '{ "name": "treblle_project_id", "value": "YOUR_TREBLLE_PROJECT_ID" }'
```

**Verify the entries:**

```bash
curl "https://apigee.googleapis.com/v1/organizations/YOUR_ORGANIZATION/environments/YOUR_ENVIRONMENT/keyvaluemaps/treblle-kvm/entries" \
-H "Authorization: Bearer $(gcloud auth print-access-token)"
```

### 3. Upload Policies to Apigee

1. Upload `treblle-apigee-policy.js` as a new JavaScript resource in your Apigee proxy API.
2. Create the policies by pasting the content of the XML files into new policies in your API proxy or shared flow.

### 4. Create a Shared Flow

Create a new Shared Flow in Apigee and add the following steps:

- Add `SC-Call-Treblle-Primary` as the first step.
- Add `SC-Call-Treblle-Fallback` as the second step with the condition: `servicecallout.SC-Call-Treblle-Primary.failed = "true"`

The Shared Flow XML should look like this:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<SharedFlow name="default">
  <Step>
    <Name>SC-Call-Treblle-Primary</Name>
  </Step>
  <Step>
    <Name>SC-Call-Treblle-Fallback</Name>
    <Condition>servicecallout.SC-Call-Treblle-Primary.failed = "true"</Condition>
  </Step>
</SharedFlow>
```

### 5. Attach Policies to the API Proxy Flow

To ensure the policy captures the full request and response cycle without adding latency, attach the policies as follows:

1. **Attach the JavaScript Policy**:

   - Go to the `Develop` tab of your API proxy.
   - Select the **PreFlow** of the **Proxy Endpoint** section.
   - Add a new **JavaScript** policy to the **Response** flow.
   - Select the `treblle-apigee-policy.js` script you uploaded.
   - Name the policy `JS-treblle`.

2. **Attach the KVM Policy**:

   - In the **PostFlow** of the **Proxy Endpoint** section.
   - Add the **Key Value Map Operations** policy (`KVM-Treblle`) to the **Request** flow.
   - Update the `mapIdentifier` in `KVM-Treblle.xml` to match your KVM name (e.g., `treblle-kvm`).
   - Name the policy `KVM-Treblle`.

3. **Attach the Flow Call Policy**:
   - In the **PostFlow** of the **Proxy Endpoint** section.
   - Add a **Flow Call** policy to the **Response** flow.
   - Configure it to call the Shared Flow you created.
   - Name the policy `FC-Async-Treblle-Logger`.

Your Proxy Endpoint flow should look like this:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ProxyEndpoint name="default">
  <Description/>
  <FaultRules/>
  <PreFlow name="PreFlow">
    <Request/>
    <Response>
      <Step>
        <Name>JS-treblle</Name>
      </Step>
    </Response>
  </PreFlow>
  <PostFlow name="PostFlow">
    <Request>
      <Step>
        <Name>KVM-Treblle</Name>
      </Step>
    </Request>
    <Response>
      <Step>
        <Name>FC-Async-Treblle-Logger</Name>
      </Step>
    </Response>
  </PostFlow>
  <Flows/>
  <HTTPProxyConnection>
    <BasePath>/treblle-demo</BasePath>
    <Properties/>
  </HTTPProxyConnection>
  <RouteRule name="default">
    <TargetEndpoint>default</TargetEndpoint>
  </RouteRule>
</ProxyEndpoint>
```

### 6. Save and Deploy

Save the changes to your API proxy and Shared Flow, then deploy the new revision. Your API traffic will now be monitored by Treblle.
