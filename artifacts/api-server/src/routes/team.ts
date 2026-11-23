import { Router, type IRouter, type RequestHandler } from "express";

interface AuthUser {
  id: string;
}

const router: IRouter = Router();

const getSupabaseConfig = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error("SUPABASE_CONFIG_MISSING");
  }

  return { url, publishableKey };
};

const getBearerToken = (authorization: string | undefined) => {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
};

const forwardSupabaseRead = async (
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  resource: string,
) => {
  const token = getBearerToken(req.get("authorization"));
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  try {
    const { url, publishableKey } = getSupabaseConfig();
    const response = await fetch(
      `${url}/rest/v1/${resource}`,
      {
        method: "GET",
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (!response.ok) {
      const status =
        response.status === 401 || response.status === 403
          ? response.status
          : response.status === 429 || response.status >= 500
            ? 503
            : 502;
      res.status(status).json({
        error:
          status === 401
            ? "Unauthorized"
            : status === 403
              ? "Forbidden"
              : "Team data service unavailable",
      });
      return null;
    }

    return (await response.json()) as unknown;
  } catch {
    res.status(503).json({ error: "Team data service unavailable" });
    return null;
  }
};

const isRecordArray = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "object" && item !== null);

router.get("/me", async (req, res) => {
  const authUser = res.locals.authUser as AuthUser | undefined;
  if (!authUser?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const employeeQuery = new URLSearchParams({
    select: "id,user_id,email,full_name,job_title,rank,status,created_at",
    user_id: `eq.${authUser.id}`,
    status: "eq.active",
    limit: "1",
  });

  const employeeResult = await forwardSupabaseRead(
    req,
    res,
    `team_employees?${employeeQuery.toString()}`,
  );
  if (!isRecordArray(employeeResult)) return;

  const employee = employeeResult[0];
  if (!employee || typeof employee.id !== "string") {
    res.status(403).json({ error: "Active team membership required" });
    return;
  }

  const roleQuery = new URLSearchParams({
    select: "role:team_roles(id,code,name_en,name_ar)",
    employee_id: `eq.${employee.id}`,
  });
  const roleResult = await forwardSupabaseRead(
    req,
    res,
    `team_employee_roles?${roleQuery.toString()}`,
  );
  if (!isRecordArray(roleResult)) return;

  res.json({ employee, roles: roleResult });
});

router.get("/employees", async (req, res) => {
  const query = new URLSearchParams({
    select: "id,email,full_name,job_title,rank,status,created_at",
    order: "created_at.desc",
    limit: "100",
  });

  const result = await forwardSupabaseRead(
    req,
    res,
    `team_employees?${query.toString()}`,
  );
  if (!isRecordArray(result)) return;

  res.json({ employees: result });
});

router.get("/roles", async (req, res) => {
  const rolesQuery = new URLSearchParams({
    select: "id,code,name_en,name_ar,description,is_system,is_active",
    order: "name_en.asc",
    limit: "100",
  });
  const roles = await forwardSupabaseRead(
    req,
    res,
    `team_roles?${rolesQuery.toString()}`,
  );
  if (!isRecordArray(roles)) return;

  const permissionsQuery = new URLSearchParams({
    select: "id,code,module,description",
    order: "module.asc,code.asc",
    limit: "200",
  });
  const permissions = await forwardSupabaseRead(
    req,
    res,
    `team_permissions?${permissionsQuery.toString()}`,
  );
  if (!isRecordArray(permissions)) return;

  res.json({ roles, permissions });
});

export default router;
