import { defaultTheme } from "react-admin";
import type { ThemeOptions } from "@mui/material/styles";

export function consoleTheme(mode: "light" | "dark", redesign = false): ThemeOptions {
  const dark = mode === "dark";
  const divider = redesign
    ? (dark ? "#252e40" : "#dfe3eb")
    : (dark ? "#354459" : "#e5e6e6");
  return {
    ...defaultTheme,
    palette: redesign ? {
      mode,
      primary: { main: dark ? "#8592ff" : "#3156ff", contrastText: dark ? "#090d17" : "#fff" },
      secondary: { main: dark ? "#a9b1da" : "#485a83" },
      background: { default: dark ? "#090d17" : "#f5f6f8", paper: dark ? "#0e1421" : "#fcfcfd" },
      text: { primary: dark ? "#f2f1ec" : "#0d0d10", secondary: dark ? "#a3acc1" : "#525b6c" },
      divider,
      action: { selected: dark ? "#1c264f" : "#e9edff" },
      success: { main: dark ? "#78c8a7" : "#297052" },
    } : {
      mode,
      primary: { main: dark ? "#d7bb88" : "#785e39" },
      secondary: { main: dark ? "#b0c3db" : "#294462" },
      background: {
        default: dark ? "#152235" : "#f5f3ee",
        paper: dark ? "#1d2d43" : "#ffffff",
      },
      text: {
        primary: dark ? "#ece9e2" : "#25344a",
        secondary: dark ? "#b8c4d4" : "#687487",
      },
      divider,
      success: { main: dark ? "#85c7a8" : "#347459" },
    },
    typography: {
      fontFamily: redesign
        ? 'system-ui, "Microsoft YaHei", "PingFang SC", sans-serif'
        : '"Microsoft YaHei", "PingFang SC", sans-serif',
      fontSize: 13,
      h4: { fontSize: "1.8rem", fontWeight: 650, letterSpacing: "-0.035em" },
      h6: { fontSize: "1rem", fontWeight: 650 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    shape: { borderRadius: redesign ? 8 : 10 },
    sidebar: { width: redesign ? 212 : 224, closedWidth: 58 },
    components: {
      ...defaultTheme.components,
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: "none",
            border: `1px solid ${divider}`,
            ...(redesign && { backgroundImage: "none" }),
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { minHeight: 38 } },
      },
      MuiTextField: { defaultProps: { variant: "outlined", size: "small" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            "&.Mui-focused": { outline: "none", boxShadow: "none" },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderWidth: 1,
            },
            "& input:focus, & textarea:focus": {
              outline: "none",
              boxShadow: "none",
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { padding: redesign ? "12px 16px" : "16px 18px" },
          head: {
            fontWeight: 600,
            backgroundColor: redesign ? (dark ? "#151c2c" : "#f0f2f7") : (dark ? "#203148" : "#fafaf8"),
            color: redesign ? (dark ? "#bdc7dd" : "#485469") : (dark ? "#bcc8d7" : "#687487"),
          },
        },
      },
      MuiDialog: { styleOverrides: { paper: { backgroundImage: "none" } } },
    },
  };
}
