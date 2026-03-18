"use client";

import { useEffect, useState } from "react";
import { motion, useSpring } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  format?: "currency" | "number";
  className?: string;
}

function formatValue(value: number, fmt: "currency" | "number"): string {
  const n = Math.round(value);
  if (fmt === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US").format(n);
}

export function AnimatedNumber({ value, format: fmt = "number", className }: AnimatedNumberProps) {
  const spring = useSpring(value, { stiffness: 120, damping: 24 });
  const [display, setDisplay] = useState(() => formatValue(value, fmt));

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  useEffect(() => {
    const unsub = spring.on("change", (latest) => {
      setDisplay(formatValue(latest, fmt));
    });
    return unsub;
  }, [spring, fmt]);

  return (
    <motion.span
      className={className}
      key={display}
      initial={{ opacity: 0.7, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      {display}
    </motion.span>
  );
}
