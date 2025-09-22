# Treblle Apigee Policy

This repository contains a custom Apigee policy to automatically send API request and response data to your [Treblle](https://treblle.com/) project. It helps you monitor, debug, and observe your APIs with ease.

## Overview

The policy captures detailed information about each API transaction processed by your Apigee proxy. This includes request and response headers, bodies, server information, load times, and errors. The collected data is then securely sent to your Treblle project for real-time analysis and visualization.

This implementation is designed to be non-blocking. It collects data during the response flow and sends it asynchronously to Treblle, ensuring that it does not add latency to the responses sent to your clients.

## Features

- **Easy Integration**: Simple to add to any Apigee API proxy.
- **Asynchronous Logging**: Uses a Service Callout in the PostFlow to avoid impacting client response times.
- **Configurable**: Easily set your Treblle API Key and Project ID.
- **Detailed Error Reporting**: Captures Apigee fault variables and HTTP error states automatically.
- **Robust and Safe**: Includes validation and error handling to prevent policy failures.

## Components

1.  **`treblle-apigee-policy-mvp.js`**: A JavaScript policy that:
    - Collects request, response, server, and error data.
    - Formats the data into the JSON payload expected by the Treblle API.
    - Stores the payload and required HTTP headers into Apigee context variables.

2.  **`callout.xml`**: A Service Callout policy (`SC-callout`) that:
    - Reads the payload and headers from the context variables set by the JavaScript policy.
    - Makes an asynchronous HTTP POST request to the Treblle API endpoint (`https://rocknrolla.treblle.com`).

## Installation and Configuration

Follow these steps to integrate the Treblle policy into your Apigee API proxy:

### 1. Configure the JavaScript Policy

Open the `treblle-apigee-policy-mvp.js` file and update the configuration variables at the top:

```javascript
// ==================== CONFIGURATION ====================
var apiKey = 'YOUR_API_KEY_HERE'; // Replace with your Treblle API key
var projectId = 'YOUR_PROJECT_ID_HERE'; // Replace with your Treblle project ID
// ...
```

Replace `'YOUR_API_KEY_HERE'` and `'YOUR_PROJECT_ID_HERE'` with your actual Treblle credentials.

### 2. Upload Policies to Apigee

1.  Upload the `treblle-apigee-policy-mvp.js` file as a new JavaScript resource in your Apigee environment.
2.  Create a new Service Callout policy in your API proxy and paste the content of `callout.xml` into it. Name the policy `SC-callout`.

### 3. Attach Policies to the Proxy Flow

To ensure the policy captures the full request and response cycle without adding latency, attach the policies to the **Proxy Endpoint Response Flow**.

1.  **Attach the JavaScript Policy**:
    - Go to the `Develop` tab of your API proxy.
    - Select the **PreFlow** of the **Proxy Endpoint** section.
    - Add a new **JavaScript** policy to the **Response** flow.
    - Select the `treblle-apigee-policy-mvp.js` script you uploaded.

2.  **Attach the Service Callout Policy**:
    - Go to the `Develop` tab of your API proxy.
    - Select the **PostFlow** of the **Proxy Endpoint** section.
    - Add the **Service Callout** policy (`SC-callout`) to the **Response** flow. This ensures it runs after the target response has been received and processed.

Your flow should look like this:

```
Proxy Endpoint (Response Flow)
|
|--> Preflow
|    |
|    '--> [JS] treblle-apigee-policy-mvp.js
|
|--> (Conditional Flows)
|
|--> Postflow
|    |
|    '--> [Service Callout] SC-callout
|
'--> Target Endpoint
```

### 4. Save and Deploy

Save the changes to your API proxy and deploy the new revision. Your API traffic will now be monitored by Treblle.
