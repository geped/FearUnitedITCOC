// Bound every outbound request, including consumption of its response body.
// Existing caller cancellation remains effective; no retries on mutations.
function createBoundedFetch(timeoutMs = 20000) {
    return (url, options = {}) => {
        const deadline = AbortSignal.timeout(timeoutMs);
        const signal = options.signal
            ? AbortSignal.any([options.signal, deadline]) : deadline;
        return globalThis.fetch(url, { ...options, signal });
    };
}
module.exports = { createBoundedFetch };
