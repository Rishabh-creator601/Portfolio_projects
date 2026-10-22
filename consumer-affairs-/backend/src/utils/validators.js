const { z } = require('zod');

const ROLES = ['field_inspector', 'senior_inspector', 'controller', 'legal_officer', 'auditor'];

const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required')
});

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  password: passwordSchema,
  role: z.enum(ROLES, { errorMap: () => ({ message: `Role must be one of: ${ROLES.join(', ')}` }) }),
  jurisdiction: z.string().trim().min(1, 'Jurisdiction is required').max(120),
  displayName: z.string().trim().min(2, 'Display name is required').max(120)
});

// Public self-registration. Deliberately narrower than registerSchema: the
// caller cannot choose a role, so it can never mint a Controller.
const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  password: passwordSchema,
  displayName: z.string().trim().min(2, 'Full name is required').max(120),
  jurisdiction: z.string().trim().max(120).optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema
});

const updateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  displayName: z.string().trim().min(2).max(120).optional(),
  isActive: z.boolean().optional()
});

/** Express middleware that replaces req.body with the parsed, typed result. */
const validate = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: {
        message: parsed.error.issues.map((i) => i.message).join('. '),
        code: 400,
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      }
    });
  }

  req.body = parsed.data;
  next();
};

module.exports = {
  ROLES,
  validate,
  loginSchema,
  registerSchema,
  signupSchema,
  changePasswordSchema,
  updateUserSchema,
  passwordSchema
};
