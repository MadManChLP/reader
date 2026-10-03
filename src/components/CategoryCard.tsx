import React from 'react';

interface CategoryCardProps {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  image?: string;
}

export const CategoryCard: React.FC<CategoryCardProps> = ({ title, icon, onClick, image }) => {
  return (
    <div
      onClick={onClick}
      className="relative flex items-center justify-center min-w-[140px] h-16 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:border-theme-500/50 transition-all cursor-pointer group overflow-hidden"
    >
      {/* Background image if provided */}
      {image && (
        <img
          src={image}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:opacity-40 transition-opacity"
        />
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex items-center gap-2 px-4">
        <span className="text-theme-400 group-hover:text-theme-300 transition-colors">
          {icon}
        </span>
        <span className="text-sm font-semibold text-white/90 group-hover:text-white transition-colors">
          {title}
        </span>
      </div>
    </div>
  );
};
