/**
 * Treblle Apigee Policy
 */

// ==================== CONFIGURATION ====================
var apiKey = context.getVariable('treblle_api_key'); // Read from KVM
var projectId = context.getVariable('treblle_project_id'); // Read from KVM
var maskingKeywords = "password,pwd,secret,password_confirmation,cc,card_number,ccv,ssn,credit_score";

var debug = properties.debug || false;
var logBody = properties.logBody || true;
var version = 0.6;
var sdkName = 'apigee';
var internal_id = context.getVariable('apiproxy.name') || 'fixme';

// ==================== UTILITY FUNCTIONS ====================

/**
 * Validates if a value is not null, undefined, or empty string
 */
function isValid(value) {
    return value !== null && value !== undefined && value !== '';
}

/**
 * Validates configuration values
 */
function validateConfiguration() {
    var errors = [];

    if (!isValid(apiKey) || apiKey === 'fixme') {
        errors.push('apiKey is not configured');
    }

    if (!isValid(projectId) || projectId === 'fixme') {
        errors.push('projectId is not configured');
    }

    if (!isValid(internal_id) || internal_id === 'fixme') {
        errors.push('internal_id is not configured');
    }

    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * Safe number parsing with default fallback
 */
function safeParseInt(value, defaultValue) {
    if (!isValid(value)) return defaultValue || 0;
    var parsed = parseInt(value);
    return isNaN(parsed) ? (defaultValue || 0) : parsed;
}

/**
 * Masks sensitive data in objects based on masking keywords
 */
function maskSensitiveData(obj, keywords) {
    if (!obj || typeof obj !== 'object' || !keywords) {
        return obj;
    }

    var keywordList = keywords.split(',').map(function (k) { return k.trim().toLowerCase(); });

    function maskObject(o) {
        if (Array.isArray(o)) {
            return o.map(maskObject);
        } else if (o !== null && typeof o === 'object') {
            var masked = {};
            for (var key in o) {
                if (o.hasOwnProperty(key)) {
                    var lowerKey = key.toLowerCase();
                    if (keywordList.indexOf(lowerKey) > -1) {
                        masked[key] = '*****';
                    } else {
                        masked[key] = maskObject(o[key]);
                    }
                }
            }
            return masked;
        }
        return o;
    }

    return maskObject(obj);
}

// ==================== HEADER FUNCTIONS ====================

/**
 * Safely gets a header value from headers object
 */
function getHeader(headersObject, headerName) {
    if (!headersObject || !(headerName in headersObject)) {
        return undefined;
    }

    var headerValue = headersObject[headerName];
    if (Array.isArray(headerValue)) {
        return headerValue.length > 0 ? headerValue.join(',') : undefined;
    }

    return headerValue;
}

/**
 * Gets all headers from a headers object
 */
function getAllHeaders(headersObject) {
    if (!headersObject) {
        return {};
    }

    var headers = {};
    for (var headerName in headersObject) {
        var headerValue = getHeader(headersObject, headerName);
        if (headerValue !== undefined) {
            headers[headerName] = headerValue;
        }
    }

    return headers;
}

// ==================== TIME FUNCTIONS ====================

/**
 * Pads number with leading zero if needed
 */
function pad(num) {
    return num < 10 ? '0' + num : num;
}

/**
 * Formats date for Treblle timestamp (yyyy-MM-dd HH:mm:ss)
 */
function formatTreblleTimestamp(date) {
    if (!date || !(date instanceof Date)) {
        return formatTreblleTimestamp(new Date());
    }

    var year = date.getFullYear();
    var month = pad(date.getMonth() + 1);
    var day = pad(date.getDate());
    var hours = pad(date.getHours());
    var minutes = pad(date.getMinutes());
    var seconds = pad(date.getSeconds());

    return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
}

/**
 * Calculates load time in microseconds
 */
function calculateLoadTime(startTime, endTime) {
    if (!startTime || !endTime) {
        return 0;
    }
    return (endTime.getTime() - startTime.getTime()) * 1000;
}

/**
 * Gets validated timestamps
 */
function getTimestamps() {
    var now = new Date();
    var requestStartTimeMillis = context.getVariable('client.received.start.timestamp');
    var requestStartTime = requestStartTimeMillis ? new Date(safeParseInt(requestStartTimeMillis)) : now;

    return {
        requestTime: requestStartTime,
        responseTime: now,
        requestTimestamp: formatTreblleTimestamp(requestStartTime),
        responseTimestamp: formatTreblleTimestamp(now),
        loadTime: calculateLoadTime(requestStartTime, now)
    };
}

// ==================== SYSTEM INFO FUNCTIONS ====================

/**
 * Gets validated server information
 */
function getServerInfo() {
    return {
        ip: context.getVariable('system.interface.eth0') || context.getVariable('client.ip') || '127.0.0.1',
        timezone: context.getVariable('system.time.zone') || 'UTC',
        software: 'Apigee',
        signature: '',
        protocol: context.getVariable('client.scheme') ? context.getVariable('client.scheme').toUpperCase() : 'HTTP/1.1',
        encoding: 'UTF-8',
        os: {
            name: '',
            release: '',
            architecture: ''
        }
    };
}

/**
 * Gets language information for the runtime environment
 */
function getLanguageInfo() {
    return {
        name: 'js',
        version: ''
    };
}

/**
 * Gets validated client IP
 */
function getClientIP() {
    var req = (typeof request !== 'undefined' && request) ? request : {};
    var headers = req.headers || {};

    var clientIP = getHeader(headers, 'X-Forwarded-For') ||
        getHeader(headers, 'X-Real-IP') ||
        getHeader(headers, 'X-Client-IP') ||
        context.getVariable('client.ip') ||
        '127.0.0.1';

    // Handle comma-separated IPs (take first one)
    if (clientIP && clientIP.indexOf(',') > -1) {
        clientIP = clientIP.split(',')[0].trim();
    }

    return clientIP;
}

// ==================== ERROR HANDLING FUNCTIONS ====================

/**
 * Generates error array using Apigee fault variables and response data
 */
function generateErrors(responseBody, statusCode) {
    var errors = [];

    // First check if we're in an error state with Apigee fault variables
    var faultName = context.getVariable("fault.name");
    if (faultName) {
        var faultReason = context.getVariable("fault.reason");
        var faultCategory = context.getVariable("fault.category");
        var faultSubcategory = context.getVariable("fault.subcategory");
        var errorMessage = context.getVariable("error.message");
        var errorContent = context.getVariable("error.content");
        var errorState = context.getVariable("error.state");

        // Build comprehensive error message from available fault information
        var message = errorMessage || errorContent || faultReason || "An Apigee policy error occurred";

        // Use fault name as error type
        var errorType = faultName;

        // Determine error source type based on Treblle specification
        // Values can be onError, onException, onShutdown
        var source = "onError"; // Default for Apigee policy errors

        // For certain fault types, we might classify as exceptions
        if (faultName && (faultName.indexOf('Exception') > -1 ||
            faultName.indexOf('Timeout') > -1 ||
            faultName.indexOf('Connection') > -1)) {
            source = "onException";
        }

        // Build detailed file information from fault category/subcategory
        var fileInfo = "apigee-policy";
        if (faultCategory) {
            fileInfo = faultCategory;
            if (faultSubcategory) {
                fileInfo += "." + faultSubcategory;
            }
        }

        // Create detailed error object using Apigee fault information
        var apigeeError = {
            source: source,
            type: errorType,
            message: message,
            file: fileInfo,
            line: errorState ? safeParseInt(errorState, 0) : 0 // Use error state as line if numeric
        };

        errors.push(apigeeError);

        return errors;
    }

    // If no Apigee fault but HTTP error status, create HTTP error
    if (statusCode >= 400) {
        var errorMessage = 'HTTP Error ' + statusCode;

        // Extract error message from response body
        if (responseBody && typeof responseBody === 'object') {
            if (responseBody.message) {
                errorMessage = responseBody.message;
            } else if (responseBody.error) {
                errorMessage = responseBody.error;
            }
        } else if (responseBody && typeof responseBody === 'string') {
            errorMessage = responseBody.substring(0, 200);
        }

        var httpError = {
            source: 'onError',
            type: 'API Request failure',
            message: errorMessage,
            file: 'http-response',
            line: 0
        };

        errors.push(httpError);
    }

    return errors;
}

// ==================== BODY PARSING FUNCTIONS ====================

/**
 * Parses body content based on content type
 */
function parseBody(content, headers) {
    if (!content) {
        return {
            body: [],
            transferEncoding: undefined
        };
    }

    var contentType = getHeader(headers, 'Content-Type') || '';
    var isJSON = contentType.indexOf('json') > -1;

    if (logBody && isJSON) {
        try {
            var parsedBody = JSON.parse(content);
            var maskedBody = maskSensitiveData(parsedBody, maskingKeywords);
            return {
                body: maskedBody,
                transferEncoding: undefined
            };
        } catch (e) {
            return {
                body: [],
                transferEncoding: undefined
            };
        }
    }

    return {
        body: [],
        transferEncoding: undefined
    };
}

// ==================== REQUEST/RESPONSE DATA FUNCTIONS ====================

/**
 * Extracts and validates request data
 */
function getRequestData() {
    var req = (typeof request !== 'undefined' && request) ? request : {};
    var headers = req.headers || {};
    var parsedBody = parseBody(req.content, headers);

    return {
        timestamp: '', // Will be set by getTimestamps()
        ip: getClientIP(),
        url: context.getVariable('proxy.url'),
        user_agent: getHeader(headers, 'User-Agent') || 'Unknown',
        method: (req.method || 'GET').toUpperCase(),
        headers: getAllHeaders(headers),
        body: parsedBody.body
    };
}

/**
 * Extracts and validates response data
 */
function getResponseData() {
    var res = (typeof response !== 'undefined' && response) ? response : {};
    var headers = res.headers || {};
    var parsedBody = parseBody(res.content, headers);
    var statusCode = res.status ? safeParseInt(res.status.code, 0) : 0;

    return {
        headers: getAllHeaders(headers),
        code: statusCode,
        size: getHeader(headers, 'Content-Length') ? safeParseInt(getHeader(headers, 'Content-Length')) : (res.content ? res.content.length : 0),
        load_time: 0, // Will be set by getTimestamps()
        body: parsedBody.body,
        statusCode: statusCode, // For error generation
        parsedBody: parsedBody.body // For error generation
    };
}

// ==================== MAIN PAYLOAD BUILDER ====================

/**
 * Builds complete Treblle payload with validation
 */
function buildTrebllePayload() {
    // Get validated timestamps
    var timestamps = getTimestamps();

    // Get validated server info
    var serverInfo = getServerInfo();

    // Get validated request data
    var requestData = getRequestData();
    requestData.timestamp = timestamps.requestTimestamp;

    // Get validated response data
    var responseData = getResponseData();
    responseData.load_time = timestamps.loadTime;

    // Generate errors if needed
    var errors = generateErrors(responseData.parsedBody, responseData.statusCode);

    // Get language info
    var languageInfo = getLanguageInfo();

    // Build final payload
    var payload = {
        api_key: apiKey,
        project_id: projectId,
        version: version,
        internal_id: internal_id,
        sdk: sdkName,
        data: {
            server: serverInfo,
            language: languageInfo,
            request: requestData,
            response: {
                headers: responseData.headers,
                code: responseData.code,
                size: responseData.size,
                load_time: responseData.load_time,
                body: responseData.body
            },
            errors: errors
        }
    };

    return payload;
}

// ==================== MAIN LOGIC ====================
// Main Logic: Prepare and Send Event to Treblle

if (!apiKey || apiKey === 'fixme') {
    // API key not configured
    logCritical("API key is not configured");
}

if (!projectId || projectId === 'fixme') {
    // Project ID not configured
    logCritical("Project ID is not configured");
}

try {
    // Extract the event data
    var trebllePayload = buildTrebllePayload();

    var trebllePayloadJson = JSON.stringify(trebllePayload);

    // Store the JSON payload in Apigee context variables
    // These variables will be used by the Service Callout policy

    try {
        context.setVariable('treblle_payload', trebllePayloadJson);
    } catch (e) {
        throw e;
    }

    try {
        context.setVariable('treblle_content_type', 'application/json');
    } catch (e) {
        throw e;
    }

    try {
        context.setVariable('treblle_x_api_key', apiKey);
    } catch (e) {
        throw e;
    }

    try {
        context.setVariable('treblle_user_agent', 'Apigee-plugin-treblle');
    } catch (e) {
        throw e;
    }

    // Verify variables were set immediately
    var verifyPayload = context.getVariable('treblle_payload');
    var verifyContentType = context.getVariable('treblle_content_type');
    var verifyApiKey = context.getVariable('treblle_x_api_key');
    var verifyUserAgent = context.getVariable('treblle_user_agent');

    // Define Treblle hosts
    var treblleHosts = [
        'rocknrolla.treblle.com',
        'punisher.treblle.com',
        'sicario.treblle.com'
    ];

    // Shuffle the array to randomize the order (ES5 compliant)
    var i = treblleHosts.length; // Use var for loop variable
    while (i > 0) {
        var j = Math.floor(Math.random() * i); // Use var
        i--;
        // Swap elements (ES5 compliant - no destructuring)
        var temp = treblleHosts[i]; // Use var
        treblleHosts[i] = treblleHosts[j];
        treblleHosts[j] = temp;
    }

    // Pick the first two unique hosts from the shuffled list
    var primaryHost = treblleHosts[0];
    var fallbackHost = treblleHosts[1];

    // Set the hosts into context variables for the ServiceCallout policies in shared flow
    context.setVariable('treblle.primary.host', primaryHost);
    context.setVariable('treblle.fallback.host', fallbackHost);

} catch (error) {
    // Catch any synchronous errors in the main flow

    // Set fallback payload to prevent downstream errors
    var fallbackPayload = {
        error: "Failed to generate payload",
        errorMessage: error.message,
        timestamp: formatTreblleTimestamp(new Date())
    };

    context.setVariable('treblle_payload', JSON.stringify(fallbackPayload));
    context.setVariable('treblle_content_type', 'application/json');

}