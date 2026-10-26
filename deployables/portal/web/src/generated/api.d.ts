export interface paths {
    "/api/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current user and CSRF token */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List collections (students: no drafts; ballot_count and participation editors only) */
        get: operations["getCategories"];
        put?: never;
        /** Create collection of any kind (admins and managers; manager creator receives a category grant atomically) */
        post: operations["postCategories"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a single-answer collection and its votes/history (admin only; 400 repeatable, 404 missing, 409 stale version) */
        delete: operations["deleteCategoriesId"];
        options?: never;
        head?: never;
        /** Update collection (admins or managers with grant; ballot definitions only before first opening); kind changes stay within content family, repeatable and schedule fixed after creation */
        patch: operations["patchCategoriesId"];
        trace?: never;
    };
    "/api/v1/submissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List authorized submissions */
        get: operations["getSubmissions"];
        put?: never;
        /** Create idempotent contribution */
        post: operations["postSubmissions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read authorized contribution */
        get: operations["getSubmissionsId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit own pending contribution with optimistic concurrency; editorial roles cannot change another author’s original */
        patch: operations["patchSubmissionsId"];
        trace?: never;
    };
    "/api/v1/submissions/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Transition contribution status */
        post: operations["postSubmissionsIdStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read contribution revision history */
        get: operations["getSubmissionsIdRevisions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Attach image to own pending contribution; original content stays author-owned */
        post: operations["postSubmissionsIdAttachments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/attachments/{attachmentID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove attachment from own pending contribution */
        delete: operations["deleteSubmissionsIdAttachmentsAttachmentid"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/attachments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read authorized original image */
        get: operations["getAttachmentsId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/attachments/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read authorized image preview */
        get: operations["getAttachmentsIdPreview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/corrections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read correction requests */
        get: operations["getSubmissionsIdCorrections"];
        put?: never;
        /** Add editorial annotation with category grant (any status), or author correction request on locked contribution */
        post: operations["postSubmissionsIdCorrections"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/corrections/{correctionID}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve correction request */
        post: operations["postSubmissionsIdCorrectionsCorrectionidResolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/roster": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Verified cohort names */
        get: operations["getRoster"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export all collected contributions by default, with optional explicit status filter (editors, repeatable only) */
        get: operations["getCategoriesIdExport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admin user list */
        get: operations["getAdminUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete user without content */
        delete: operations["deleteAdminUsersId"];
        options?: never;
        head?: never;
        /** Admin admission and grants */
        patch: operations["patchAdminUsersId"];
        trace?: never;
    };
    "/api/v1/admin/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recent administrative audit events */
        get: operations["getAdminAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Backup freshness and storage */
        get: operations["getAdminStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Open, close or hide a collection (admin or manager with grant; draft->open, open->closed, open/closed->draft). Expired collections cannot reopen. Hiding preserves votes/history and first opened_at; reopening keeps candidates fixed. */
        post: operations["postCategoriesIdStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/ballot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Cast a named ballot: replace current selection when one-off; append an idempotent entry when repeatable (ballot_id required) */
        put: operations["putCategoriesIdBallot"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/results": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Editorial aggregate counts (single-answer only) */
        get: operations["getCategoriesIdResults"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admin-only named ballot history (single-answer only) */
        get: operations["getCategoriesIdAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/words": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Editorial anonymous original word counts and moderation, word portraits only */
        get: operations["getCategoriesIdWords"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/words/{optionID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Grant-controlled reversible word exclusion/correction/merge; originals and named history stay unchanged */
        patch: operations["patchCategoriesIdWordsOptionID"];
        trace?: never;
    };
    "/api/v1/categories/{id}/words/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Editorial CSV export of included effective words and distinct voter counts, word portraits only */
        get: operations["getCategoriesIdWordsExport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        User: {
            id: string;
            name: string;
            /** @enum {string} */
            role: "student" | "manager" | "admin";
            admitted: boolean;
            cohort_member: boolean;
            category_ids: string[];
            /** Format: date-time */
            created_at: string;
        };
        Me: {
            user: components["schemas"]["User"];
            csrf_token: string;
        };
        Category: {
            id: string;
            name: string;
            description: string;
            /** @enum {string} */
            kind: "idea" | "quote" | "memory" | "photo" | "person" | "proposal" | "words";
            /** @description No scheduled closing when true (default); false requires a future closes_at. Stored independently of content kind and repeatability. */
            ongoing: boolean;
            /**
             * Format: date-time
             * @description Automatic closing instant for bounded collections; null when ongoing. Open collections are effectively closed at this instant.
             */
            closes_at: string | null;
            /** @description Allow multiple contributions or independent ballot entries per person, independently of kind. False ballots retain one changeable current selection. */
            repeatable: boolean;
            /**
             * @description All kinds support draft, open and closed; the closing deadline also makes open collections effectively closed. Draft means hidden from students, including previously opened polls; opened_at distinguishes editable new drafts from locked hidden polls.
             * @enum {string}
             */
            status: "draft" | "open" | "closed";
            allow_self_vote: boolean;
            /** @description Empty for contribution kinds, word portraits, and all_people person poll input; otherwise explicit voting options. Word portrait responses never expose other voters’ words. */
            options: components["schemas"]["PollOption"][];
            /** @description First current selection in canonical ID order (legacy compatibility), or null. */
            my_option_id: string | null;
            version: number;
            /** Format: date-time */
            created_at: string;
            /**
             * Format: date-time
             * @description Set once when a single-answer category moves from draft to open; creation time for repeatable ones.
             */
            opened_at: string | null;
            /** @description Number of distinct current voters. Editors only; null for students and contribution categories. */
            ballot_count: number | null;
            /** @description Current voting participation among admitted cohort members, regardless of role. Both counts use the same population and database snapshot. Editors only; null for students and contribution categories. Preserved ballots from people no longer eligible are excluded here but remain in ballot_count. */
            participation: {
                /** @description Currently eligible people with a current ballot in this collection. */
                voted: number;
                /** @description All currently admitted cohort members. */
                eligible: number;
            } | null;
            /** @description Person polls only: all admitted cohort members, refreshed when opening and fixed thereafter. Existing polls retain explicit candidates. */
            all_people: boolean;
            /** @description Maximum selections for person/proposal polls or words per voter for word portraits (1–500). Word portraits default to 3, other polls to 1; contribution kinds require 1. */
            max_choices: number;
            /** @description Viewer’s complete current selection; empty for contribution categories or before voting. */
            my_option_ids: string[];
            /** @description Only the viewer’s current original normalized words, empty for other kinds or before voting. Originals are unchanged by editorial moderation. */
            my_words?: string[];
        };
        Attachment: {
            id: string;
            filename: string;
            mime_type: string;
            size_bytes: number;
            url: string;
            preview_url: string;
        };
        Submission: {
            id: string;
            category_id: string;
            author_id: string;
            author_name: string;
            title: string;
            body: string;
            context: string;
            /** @enum {string} */
            status: "pending" | "accepted" | "rejected" | "withdrawn";
            version: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            attachments: components["schemas"]["Attachment"][];
        };
        Revision: {
            id: string;
            version: number;
            actor_name: string;
            title: string;
            body: string;
            context: string;
            /** @enum {string} */
            status: "pending" | "accepted" | "rejected" | "withdrawn";
            /** Format: date-time */
            created_at: string;
        };
        Correction: {
            id: string;
            submission_id: string;
            author_name: string;
            body: string;
            /** Format: date-time */
            created_at: string;
            resolved: boolean;
        };
        PollOption: {
            id: string;
            label: string;
            user_id?: string;
        };
        PollResult: {
            option_id: string;
            label: string;
            count: number;
        };
        BallotAudit: {
            user_id: string;
            user_name: string;
            option_id: string;
            option_label: string;
            /** Format: date-time */
            created_at: string;
            /** @description Groups the complete selection from one ballot change. Null for legacy single-choice history. */
            ballot_id: string | null;
        };
        AuditEvent: {
            id: string;
            actor_name: string;
            action: string;
            entity_id: string;
            /** Format: date-time */
            created_at: string;
        };
        SystemStatus: {
            backup_last_success: string | null;
            backup_stale: boolean;
            upload_bytes: number;
        };
        RosterEntry: {
            id: string;
            name: string;
        };
        Error: {
            error: {
                code: string;
                message: string;
            };
        };
        CategoryInput: {
            name: string;
            description: string;
            /** @enum {string} */
            kind: "idea" | "quote" | "memory" | "photo" | "person" | "proposal" | "words";
            /** @description No scheduled closing when true (default); false requires a future closes_at. Stored independently of content kind and repeatability. */
            ongoing?: boolean;
            /**
             * Format: date-time
             * @description Automatic closing instant for bounded collections; null when ongoing. Open collections are effectively closed at this instant.
             */
            closes_at?: string | null;
            /** @description Allow multiple contributions per person independently of kind. Omission defaults from kind on create and preserves the stored flag on edit. */
            repeatable?: boolean;
            allow_self_vote?: boolean;
            /** @description Empty for contribution kinds, word portraits, and all_people person poll input; otherwise explicit voting options. Word portrait responses never expose other voters’ words. */
            options?: {
                label: string;
                user_id?: string;
            }[];
            /** @description Person polls: all admitted cohort members instead of explicit options. Defaults true on creation; omission preserves mode on edit. Other kinds require false. */
            all_people?: boolean;
            /** @description Maximum selections for person/proposal polls or words per voter for word portraits (1–500). Word portraits default to 3, other polls to 1; contribution kinds require 1. */
            max_choices?: number;
        };
        SubmissionInput: {
            idempotency_key: string;
            category_id: string;
            title: string;
            body: string;
            context: string;
        };
        SubmissionEdit: {
            version: number;
            category_id: string;
            title: string;
            body: string;
            context: string;
        };
        StatusInput: {
            version: number;
            /** @enum {string} */
            status: "pending" | "accepted" | "rejected" | "withdrawn";
        };
        UserEdit: {
            name: string;
            /** @enum {string} */
            role: "student" | "manager" | "admin";
            admitted: boolean;
            cohort_member: boolean;
            category_ids: string[];
        };
        CategoryEdit: {
            name: string;
            description: string;
            /** @enum {string} */
            kind: "idea" | "quote" | "memory" | "photo" | "person" | "proposal" | "words";
            /** @description No scheduled closing when true (default); false requires a future closes_at. Stored independently of content kind and repeatability. */
            ongoing?: boolean;
            /**
             * Format: date-time
             * @description Automatic closing instant for bounded collections; null when ongoing. Open collections are effectively closed at this instant.
             */
            closes_at?: string | null;
            /** @description Allow multiple contributions per person independently of kind. Omission defaults from kind on create and preserves the stored flag on edit. */
            repeatable?: boolean;
            allow_self_vote?: boolean;
            /** @description Empty for contribution kinds, word portraits, and all_people person poll input; otherwise explicit voting options. Word portrait responses never expose other voters’ words. */
            options?: {
                label: string;
                user_id?: string;
            }[];
            version: number;
            /** @description Person polls: all admitted cohort members instead of explicit options. Defaults true on creation; omission preserves mode on edit. Other kinds require false. */
            all_people?: boolean;
            /** @description Maximum selections for person/proposal polls or words per voter for word portraits (1–500). Word portraits default to 3, other polls to 1; contribution kinds require 1. */
            max_choices?: number;
        };
        /** @description Editorial anonymous original-word tally and reversible moderation; contains no voter identity. Equal effective labels merge, counting each current voter once in results. */
        WordEntry: {
            option_id: string;
            /** @description One Unicode NFC lowercase word without whitespace or control characters; normalized on input. */
            word: string;
            /** @description One Unicode NFC lowercase word without whitespace or control characters; normalized on input. */
            label: string;
            excluded: boolean;
            count: number;
            version: number;
        };
        WordModerationInput: {
            version: number;
            /** @description One Unicode NFC lowercase word without whitespace or control characters; normalized on input. */
            label: string;
            excluded: boolean;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategories: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postCategories: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteCategoriesId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                };
            };
        };
        responses: {
            /** @description Collection deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchCategoriesId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryEdit"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSubmissions: {
        parameters: {
            query?: {
                category_id?: string;
                status?: string;
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissions: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmissionInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSubmissionsId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchSubmissionsId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmissionEdit"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissionsIdStatus: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StatusInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSubmissionsIdRevisions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Revision"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissionsIdAttachments: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                    version: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteSubmissionsIdAttachmentsAttachmentid: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
                attachmentID: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAttachmentsId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAttachmentsIdPreview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSubmissionsIdCorrections: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Correction"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissionsIdCorrections: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    body: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Correction"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissionsIdCorrectionsCorrectionidResolve: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
                correctionID: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Correction"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRoster: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RosterEntry"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdExport: {
        parameters: {
            query?: {
                /** @description Defaults to all statuses; explicit status filtering remains available for later moderation. */
                status?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/zip": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminUsers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteAdminUsersId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchAdminUsersId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserEdit"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminAudit: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEvent"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemStatus"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postCategoriesIdStatus: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                    /** @enum {string} */
                    status: "draft" | "open" | "closed";
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putCategoriesIdBallot: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: uuid
                     * @description Client-generated key required for repeatable ballots; replay with the same selection returns success without an extra entry, changed selection conflicts.
                     */
                    ballot_id?: string;
                    option_id?: string;
                    option_ids?: string[];
                    words?: string[];
                } & (unknown | unknown | unknown);
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /**
                         * Format: uuid
                         * @description Client-generated key required for repeatable ballots; replay with the same selection returns success without an extra entry, changed selection conflicts.
                         */
                        ballot_id?: string;
                        option_id: string;
                        option_ids: string[];
                        words?: string[];
                    };
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdResults: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PollResult"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdAudit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BallotAudit"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdWords: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WordEntry"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchCategoriesIdWordsOptionID: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
                optionID: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WordModerationInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WordEntry"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdWordsExport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description CSV with formula-safe word and count columns */
            200: {
                headers: {
                    "Content-Disposition"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
