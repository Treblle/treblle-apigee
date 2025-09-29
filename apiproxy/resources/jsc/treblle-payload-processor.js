/**
 * Treblle Apigee Policy
 */

// ==================== CONFIGURATION ====================
var sdkToken = context.getVariable('treblle.sdk.token');
var apiKey = context.getVariable('treblle.api.key');
// Default sensitive fields - always masked regardless of user configuration
var defaultMaskingKeywords = "password,pwd,secret,password_confirmation,passwordConfirmation,cc,card_number,cardNumber,ccv,ssn,credit_score,creditScore";

// Endpoint blocking configuration - comma-separated list of paths to exclude
var blockedEndpoints = properties.blockedEndpoints || "health,status,ping,admin/*,internal/*";

var debug = properties.debug || false;
var logBody = properties.logBody || true;
var version = 20;
var sdkName = 'apigee';
var internal_id = context.getVariable('apiproxy.name') || '';
var maxPayloadSize = 2097152; // 2MB in bytes

// Cache static arrays for performance - convert to lowercase for case-insensitive matching
var maskingKeywordsList = defaultMaskingKeywords.split(',').map(function (k) { return k.trim().toLowerCase(); });
var blockedEndpointsList = blockedEndpoints.split(',').map(function (k) { return k.trim(); });
var treblleHosts = ['rocknrolla.treblle.com', 'punisher.treblle.com', 'sicario.treblle.com'];

// Cache context variables to reduce lookups
var cachedClientIP = context.getVariable('client.ip');
var cachedProxyURL = context.getVariable('proxy.url');
var cachedPathSuffix = context.getVariable('proxy.pathsuffix');
var cachedClientScheme = context.getVariable('client.scheme');
var cachedSystemIP = context.getVariable('system.interface.eth0');

// ==================== UTILITY FUNCTIONS ====================

/**
 * Unified logging function for Treblle SDK
 */
function log(level, message, error) {
    if (debug || level === 'ERROR') {
        var timestamp = new Date().toISOString();
        var logEntry = '[' + timestamp + '] TREBLLE-' + level + ': ' + message;
        if (error && error.message) {
            logEntry += ' | Error: ' + error.message;
        }
        print(logEntry);
    }
}

/**
 * Checks if content exceeds size limit
 */
function isPayloadOversized(content) {
    if (!content) return false;
    var contentSize = (typeof content === 'string') ? content.length : JSON.stringify(content).length;
    return contentSize > maxPayloadSize;
}

/**
 * Checks if the current endpoint should be blocked from Treblle tracking
 * Supports wildcard patterns like "admin/*"
 */
function isEndpointBlocked(path) {
    if (!path) return false;
    
    // Normalize path - remove leading slash and convert to lowercase
    var normalizedPath = path.replace(/^\/+/, '').toLowerCase();
    
    for (var i = 0; i < blockedEndpointsList.length; i++) {
        var blockedPattern = blockedEndpointsList[i].toLowerCase();
        
        // Handle wildcard patterns
        if (blockedPattern.indexOf('*') > -1) {
            // Convert wildcard pattern to regex-like matching
            var patternPrefix = blockedPattern.replace('*', '');
            if (normalizedPath.indexOf(patternPrefix) === 0) {
                return true; // Path starts with the pattern prefix
            }
        } else {
            // Exact match
            if (normalizedPath === blockedPattern || normalizedPath.indexOf(blockedPattern + '/') === 0) {
                return true;
            }
        }
    }
    
    return false;
}



/**
 * Safe number parsing with default fallback
 */
function safeParseInt(value, defaultValue) {
    if (!value || value === null || value === undefined || value === '') return defaultValue || 0;
    var parsed = parseInt(value);
    return isNaN(parsed) ? (defaultValue || 0) : parsed;
}

/**
 * Masks sensitive data preserving original string length
 * Memory-optimized implementation for performance
 */
function maskSensitiveData(obj) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }

    function maskValue(value) {
        if (value === null || value === undefined || value === '') {
            return value; // Skip null, undefined, empty values
        }
        
        var stringValue = value.toString();
        var maskedLength = stringValue.length;
        
        // Memory-optimized: use Array.join for better performance on large strings
        if (maskedLength > 50) {
            var maskArray = new Array(maskedLength + 1).join('*');
            return maskArray;
        } else {
            // For small strings, simple concatenation is faster
            var masked = '';
            for (var i = 0; i < maskedLength; i++) {
                masked += '*';
            }
            return masked;
        }
    }

    function maskObject(o) {
        if (Array.isArray(o)) {
            // Mask array items individually, preserve array structure
            var maskedArray = [];
            for (var i = 0; i < o.length; i++) {
                maskedArray[i] = maskObject(o[i]);
            }
            return maskedArray;
        } else if (o !== null && typeof o === 'object') {
            // Mask object values but preserve keys
            var masked = {};
            for (var key in o) {
                if (o.hasOwnProperty(key)) {
                    var lowerKey = key.toLowerCase();
                    if (maskingKeywordsList.indexOf(lowerKey) !== -1) {
                        masked[key] = maskValue(o[key]);
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
        if (headersObject.hasOwnProperty(headerName)) {
            var headerValue = headersObject[headerName];
            if (headerValue !== undefined) {
                if (Array.isArray(headerValue)) {
                    headerValue = headerValue.length > 0 ? headerValue.join(',') : undefined;
                }
                
                // Apply masking to header values
                var lowerHeaderName = headerName.toLowerCase();
                if (maskingKeywordsList.indexOf(lowerHeaderName) !== -1) {
                    if (headerValue && headerValue !== '') {
                        var headerStringValue = headerValue.toString();
                        var headerLength = headerStringValue.length;
                        // Use efficient masking for headers
                        if (headerLength > 50) {
                            headers[headerName] = new Array(headerLength + 1).join('*');
                        } else {
                            var maskedValue = '';
                            for (var i = 0; i < headerLength; i++) {
                                maskedValue += '*';
                            }
                            headers[headerName] = maskedValue;
                        }
                    } else {
                        headers[headerName] = headerValue;
                    }
                } else {
                    headers[headerName] = headerValue;
                }
            }
        }
    }

    return headers;
}

// ==================== TIME FUNCTIONS ====================


/**
 * Formats date for Treblle timestamp (yyyy-MM-dd HH:mm:ss) in UTC
 */
function formatTreblleTimestamp(date) {
    if (!date || !(date instanceof Date)) {
        return formatTreblleTimestamp(new Date());
    }

    var year = date.getUTCFullYear();
    var month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    var day = date.getUTCDate().toString().padStart(2, '0');
    var hours = date.getUTCHours().toString().padStart(2, '0');
    var minutes = date.getUTCMinutes().toString().padStart(2, '0');
    var seconds = date.getUTCSeconds().toString().padStart(2, '0');

    return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
}

/**
 * Calculates load time in milliseconds
 */
function calculateLoadTime(startTime, endTime) {
    if (!startTime || !endTime) {
        return 0;
    }
    return endTime.getTime() - startTime.getTime();
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
 * Gets validated client IP
 */
function getClientIP() {
    var req = (typeof request !== 'undefined' && request) ? request : {};
    var headers = req.headers || {};

    var clientIP = getHeader(headers, 'X-Forwarded-For') ||
        getHeader(headers, 'X-Real-IP') ||
        getHeader(headers, 'X-Client-IP') ||
        cachedClientIP;

    // Handle comma-separated IPs (take first one)
    if (clientIP && clientIP.indexOf(',') > -1) {
        clientIP = clientIP.split(',')[0].trim();
    }

    return clientIP || 'bogon';
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
            body: {},
            transferEncoding: undefined
        };
    }

    var contentType = getHeader(headers, 'Content-Type') || '';
    var isJSON = contentType.indexOf('json') > -1;

    // Check payload size limit first
    if (isPayloadOversized(content)) {
        return {
            body: {
                message: "Payload exceeds 2MB limit and has been truncated",
                original_size: (typeof content === 'string') ? content.length : JSON.stringify(content).length,
                limit_size: maxPayloadSize,
                content_type: contentType || 'unknown'
            },
            transferEncoding: undefined
        };
    }

    if (logBody && isJSON) {
        try {
            var parsedBody = JSON.parse(content);
            var maskedBody = maskSensitiveData(parsedBody);
            return {
                body: maskedBody,
                transferEncoding: undefined
            };
        } catch (e) {
            return {
                body: {},
                transferEncoding: undefined
            };
        }
    }

    return {
        body: {},
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

    // Extract query parameters from the URL
    var url = cachedProxyURL || '';
    var queryParams = {};
    if (url.indexOf('?') > -1) {
        var queryString = url.split('?')[1];
        if (queryString) {
            var pairs = queryString.split('&');
            for (var i = 0; i < pairs.length; i++) {
                var pair = pairs[i].split('=');
                if (pair.length === 2) {
                    try {
                        queryParams[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
                    } catch (e) {
                        // Skip malformed URL components
                        queryParams[pair[0]] = pair[1];
                    }
                }
            }
        }
    }

    return {
        timestamp: '', // Will be set by getTimestamps()
        ip: getClientIP(),
        url: url,
        user_agent: getHeader(headers, 'User-Agent') || '',
        method: (req.method || 'GET').toUpperCase(),
        headers: getAllHeaders(headers),
        body: parsedBody.body,
        route_path: cachedPathSuffix,
        query: queryParams
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
        size: getHeader(headers, 'Content-Length') ? safeParseInt(getHeader(headers, 'Content-Length'), 0) : (res.content ? res.content.length : 0),
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

    // Get server info - inline since mostly static
    var serverIP = cachedSystemIP || cachedClientIP;
    var serverInfo = {
        ip: serverIP || 'bogon',
        timezone: 'UTC',
        software: 'Apigee',
        protocol: cachedClientScheme ? cachedClientScheme.toUpperCase() + '/1.1' : 'HTTP/1.1',
        os: {
            name: 'Apigee',
            release: null,
            architecture: null
        }
    };

    // Get validated request data
    var requestData = getRequestData();
    requestData.timestamp = timestamps.requestTimestamp;

    // Get validated response data
    var responseData = getResponseData();
    responseData.load_time = timestamps.loadTime;

    // Generate errors if needed
    var errors = generateErrors(responseData.parsedBody, responseData.statusCode);

    // Get language info - inline since it's static
    var languageInfo = {
        name: 'Apigee',
        version: context.getVariable('system.version') || null
    };

    // Build final payload according to schema
    var payload = {
        api_key: sdkToken,
        project_id: apiKey,
        version: parseFloat(version.toString()),
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
// FAIL FAST APPROACH - Exit early if anything is wrong

try {
    log('DEBUG', 'Starting Treblle SDK processing');
    
    // VALIDATION GATE 1: Configuration - inline validation
    var configErrors = [];
    if (!sdkToken || sdkToken === null || sdkToken === undefined || sdkToken === '') {
        configErrors.push('SDK Token is not configured');
    }
    if (!apiKey || apiKey === null || apiKey === undefined || apiKey === '') {
        configErrors.push('API Key is not configured');
    }
    
    if (configErrors.length > 0) {
        log('ERROR', 'Configuration invalid: ' + configErrors.join(', ') + ' - Skipping Treblle call');
        return; // EXIT EARLY - don't proceed with Treblle call
    }
    
    log('DEBUG', 'Configuration validated successfully');

    // VALIDATION GATE 2: Endpoint Blocking Check
    try {
        if (isEndpointBlocked(cachedPathSuffix)) {
            log('DEBUG', 'Endpoint blocked from tracking: ' + cachedPathSuffix + ' - Skipping Treblle call');
            return; // EXIT EARLY - endpoint is blocked
        }
        log('DEBUG', 'Endpoint allowed for tracking: ' + cachedPathSuffix);
    } catch (blockingError) {
        log('ERROR', 'Failed to check endpoint blocking - Allowing tracking to proceed', blockingError);
        // Don't return here - if blocking check fails, allow tracking to continue
    }

    // VALIDATION GATE 3: Build Payload
    var trebllePayload;
    try {
        trebllePayload = buildTrebllePayload();
        log('DEBUG', 'Payload built successfully');
    } catch (payloadError) {
        log('ERROR', 'Failed to build payload - Skipping Treblle call', payloadError);
        return; // EXIT EARLY - don't proceed with Treblle call
    }
    
    // VALIDATION GATE 4: Serialize Payload
    var trebllePayloadJson;
    try {
        trebllePayloadJson = JSON.stringify(trebllePayload);
        log('DEBUG', 'Payload serialized successfully - size: ' + trebllePayloadJson.length + ' bytes');
    } catch (jsonError) {
        log('ERROR', 'Failed to serialize payload - Skipping Treblle call', jsonError);
        return; // EXIT EARLY - don't proceed with Treblle call
    }

    // VALIDATION GATE 5: Host Selection
    var selectedHost;
    try {
        selectedHost = treblleHosts[Math.floor(Math.random() * treblleHosts.length)];
        log('DEBUG', 'Selected host: ' + selectedHost);
    } catch (hostError) {
        log('ERROR', 'Failed to select host - Skipping Treblle call', hostError);
        return; // EXIT EARLY - don't proceed with Treblle call
    }

    // ALL VALIDATIONS PASSED - Set context variables for ServiceCallout
    context.setVariable('treblle.payload.json', trebllePayloadJson);
    context.setVariable('treblle.content.type', 'application/json');
    context.setVariable('treblle.api.key', sdkToken);
    context.setVariable('treblle.user.agent', 'Apigee-plugin-treblle');
    context.setVariable('treblle.selected.host', selectedHost);
    
    log('DEBUG', 'All validations passed - Treblle call prepared successfully');

} catch (mainError) {
    // Ultimate safety net - never crash the host API
    log('ERROR', 'Critical error in Treblle SDK - Skipping Treblle call', mainError);
    // Just exit gracefully, don't set any context variables
}

log('DEBUG', 'Treblle SDK processing completed');