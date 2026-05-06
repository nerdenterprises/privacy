/* ===================================================
   Nerd Privacy Portal — Form submission handler
   =================================================== */

(function () {
  "use strict";

  // Update this when the Edge Function is deployed.
  // The Supabase project URL pattern is:
  //   https://<project-ref>.supabase.co/functions/v1/submit-privacy-request
  const SUBMIT_ENDPOINT = "https://ckxlldrzbcxobkkuolvb.supabase.co/functions/v1/submit-privacy-request";

  const form = document.getElementById("privacy-request-form");
  if (!form) return;

  const submitBtn = document.getElementById("submit-btn");
  const feedback = document.getElementById("form-feedback");

  function clearErrors() {
    document.querySelectorAll(".field-error").forEach(function (el) {
      el.textContent = "";
    });
    document.querySelectorAll("[aria-invalid]").forEach(function (el) {
      el.removeAttribute("aria-invalid");
    });
  }

  function setError(fieldName, message) {
    const errorEl = document.querySelector('[data-error-for="' + fieldName + '"]');
    if (errorEl) errorEl.textContent = message;
    const input = document.querySelector('[name="' + fieldName + '"]');
    if (input && input.tagName) input.setAttribute("aria-invalid", "true");
  }

  function getCheckedValues(name) {
    return Array.from(document.querySelectorAll('input[name="' + name + '"]:checked'))
      .map(function (el) { return el.value; });
  }

  function validate(payload) {
    const errors = {};

    if (!payload.name || payload.name.trim().length < 2) {
      errors.name = "Please enter your full name.";
    }
    if (payload.name && payload.name.length > 200) {
      errors.name = "Name is too long.";
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!payload.email || !emailRegex.test(payload.email)) {
      errors.email = "Please enter a valid email address.";
    }

    if (!payload.request_type) {
      errors.request_type = "Please select a request type.";
    }

    if (!Array.isArray(payload.products) || payload.products.length === 0) {
      errors.products = "Please select at least one product.";
    }

    if (!payload.description || payload.description.trim().length < 10) {
      errors.description = "Please describe your request in at least 10 characters.";
    }
    if (payload.description && payload.description.length > 5000) {
      errors.description = "Description is too long (max 5000 characters).";
    }

    if (!payload.jurisdiction) {
      errors.jurisdiction = "Please select where you live.";
    }

    if (typeof payload.current_customer !== "boolean") {
      errors.current_customer = "Please tell us whether you're a current customer.";
    }

    if (payload.verification_consent !== true) {
      errors.verification_consent = "Please confirm your understanding to continue.";
    }

    return errors;
  }

  function showSuccess(referenceNumber) {
    feedback.className = "form-feedback success";
    feedback.innerHTML =
      '<h3>Thanks &mdash; we received your request.</h3>' +
      '<p>We just sent a confirmation email with your reference number. ' +
      'Please check your inbox (and spam folder, just in case).</p>' +
      '<p>Your reference number: <span class="ref-num">' + referenceNumber + '</span></p>' +
      '<p>We\'ll respond within 30 days. If we need to verify your identity first, ' +
      'we\'ll reach out by email.</p>';
    feedback.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function showError(message) {
    feedback.className = "form-feedback error";
    feedback.textContent = message ||
      "Something went wrong submitting your request. Please try again, or email " +
      "privacy@nerdenterprises.com directly.";
    feedback.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearErrors();
    feedback.className = "";
    feedback.textContent = "";

    const formData = new FormData(form);

    // Honeypot — if filled, silently "succeed" (don't tell the bot)
    const honeypot = formData.get("website") || "";
    if (typeof honeypot === "string" && honeypot.length > 0) {
      // Fake success
      showSuccess("NRD-IGNORED");
      form.reset();
      return;
    }

    const payload = {
      name: (formData.get("name") || "").toString().trim(),
      email: (formData.get("email") || "").toString().trim(),
      request_type: (formData.get("request_type") || "").toString(),
      products: getCheckedValues("products"),
      description: (formData.get("description") || "").toString().trim(),
      jurisdiction: (formData.get("jurisdiction") || "").toString(),
      current_customer: formData.get("current_customer") === "yes"
        ? true
        : formData.get("current_customer") === "no"
          ? false
          : null,
      verification_consent: formData.get("verification_consent") === "on",
    };

    const errors = validate(payload);
    if (Object.keys(errors).length > 0) {
      Object.keys(errors).forEach(function (field) {
        setError(field, errors[field]);
      });
      // Focus first invalid field
      const firstErrorField = Object.keys(errors)[0];
      const firstInput = document.querySelector('[name="' + firstErrorField + '"]');
      if (firstInput && firstInput.focus) firstInput.focus();
      return;
    }

    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = "Submitting…";

    try {
      const response = await fetch(SUBMIT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(function () { return {}; });

      if (!response.ok) {
        if (response.status === 400 && Array.isArray(data.details)) {
          showError("Please check your responses: " + data.details.join("; "));
        } else if (response.status === 429) {
          showError("Too many requests right now. Please try again in a few minutes.");
        } else {
          showError(data.error || null);
        }
        return;
      }

      if (data && data.success && data.reference) {
        showSuccess(data.reference);
        form.reset();
      } else {
        showError(null);
      }
    } catch (err) {
      console.error("Submit error:", err);
      showError(
        "We couldn't reach our servers. Please check your connection and try again, " +
        "or email privacy@nerdenterprises.com directly."
      );
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
})();
